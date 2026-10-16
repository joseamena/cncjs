import classNames from 'classnames';
import React, { PureComponent } from 'react';
import { Link } from 'react-router-dom';
import api from 'app/api';
import controller from 'app/lib/controller';
import i18n from 'app/lib/i18n';
import GCodePreview from './GCodePreview';
import GuitarPreview from './GuitarPreview';
import styles from './index.styl';

const getMessage = (response, fallback) => {
  return response && response.body && response.body.msg ? response.body.msg : fallback;
};

const percent = (sent, total) => (total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0);

class Guitar extends PureComponent {
  state = {
    loading: true,
    error: '',
    catalog: { models: [] },
    model: null,
    part: null,
    configuration: null,
    operation: null,
    operationData: null,
    checks: {},
    zeroConfirmed: false,
    armed: false,
    armProgress: false,
    socketConnected: controller.connected,
    machineConnected: !!controller.port,
    port: controller.port,
    ports: controller.ports || [],
    selectedPort: controller.port || '',
    controllerState: controller.state || {},
    workflowState: controller.workflow.state || 'idle',
    sender: { sent: 0, total: 0, received: 0, name: '' },
    runStarted: ['running', 'paused'].includes(controller.workflow.state),
    runFinished: false,
    machinePanel: false,
    jogging: false,
    installPrompt: null,
    confirmation: ''
  };

  armTimer = null;

  activeJog = false;

  lastTouchAt = 0;

  abortRequested = false;

  listeners = {
    connect: () => this.setState({ socketConnected: true }),
    disconnect: () => {
      this.stopJog();
      this.setState({ socketConnected: false, armed: false, armProgress: false });
    },
    'serialport:list': ports => this.setState(state => ({
      ports,
      selectedPort: state.selectedPort || (ports[0] && ports[0].port) || ''
    })),
    'serialport:open': options => this.setState({
      machineConnected: true,
      port: options.port,
      selectedPort: options.port,
      machinePanel: false
    }),
    'serialport:close': () => {
      this.stopJog();
      this.setState({ machineConnected: false, port: '', armed: false });
    },
    'controller:state': (type, controllerState) => this.setState({ controllerState }),
    'workflow:state': workflowState => {
      const completed = this.state.runStarted && this.state.workflowState !== 'idle' &&
        workflowState === 'idle' && !this.abortRequested;
      if (completed) {
        this.saveHistory('completed');
      }
      if (workflowState === 'idle') {
        this.abortRequested = false;
      }
      this.setState(state => ({
        workflowState,
        runFinished: state.runStarted && state.workflowState !== 'idle' && workflowState === 'idle',
        runStarted: workflowState === 'running' || workflowState === 'paused' ? true : state.runStarted
      }));
    },
    'sender:status': sender => this.setState({ sender })
  };

  componentDidMount() {
    Object.keys(this.listeners).forEach(eventName => controller.addListener(eventName, this.listeners[eventName]));
    document.addEventListener('visibilitychange', this.visibilityChanged);
    window.addEventListener('blur', this.stopJog);
    window.addEventListener('beforeinstallprompt', this.captureInstallPrompt);
    controller.listPorts();
    this.loadCatalog();
  }

  componentWillUnmount() {
    Object.keys(this.listeners).forEach(eventName => controller.removeListener(eventName, this.listeners[eventName]));
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    window.removeEventListener('blur', this.stopJog);
    window.removeEventListener('beforeinstallprompt', this.captureInstallPrompt);
    this.cancelArm();
    this.stopJog();
  }

  captureInstallPrompt = (event) => {
    event.preventDefault();
    this.setState({ installPrompt: event });
  };

  installApp = () => {
    const prompt = this.state.installPrompt;
    if (!prompt) {
      return;
    }
    prompt.prompt();
    prompt.userChoice.then(() => this.setState({ installPrompt: null }));
  };

  visibilityChanged = () => {
    if (document.hidden) {
      this.stopJog();
      this.cancelArm();
    }
  };

  loadCatalog = () => {
    this.setState({ loading: true, error: '' });
    api.getGuitarCatalog()
      .then(response => this.setState({ catalog: response.body, loading: false }))
      .catch(response => this.setState({
        loading: false,
        error: getMessage(response, i18n._('The guitar library could not be loaded.'))
      }));
  };

  selectModel = model => this.setState({
    model,
    part: null,
    configuration: null,
    operation: null,
    operationData: null,
    checks: {},
    zeroConfirmed: false,
    armed: false
  });

  selectPart = part => this.setState({
    part,
    configuration: null,
    operation: null,
    operationData: null,
    checks: {},
    zeroConfirmed: false,
    armed: false
  });

  selectConfiguration = configuration => this.setState({
    configuration,
    operation: null,
    operationData: null,
    checks: {},
    zeroConfirmed: false,
    armed: false
  });

  selectOperation = operation => {
    const { model, part, configuration } = this.state;
    this.setState({ operation, operationData: null, checks: {}, zeroConfirmed: false, armed: false, loading: true, error: '' });
    api.getGuitarOperation({
      modelId: model.id,
      partId: part.id,
      configurationId: configuration.id,
      operationId: operation.id
    }).then(response => this.setState({ operationData: response.body, loading: false }))
      .catch(response => this.setState({
        loading: false,
        error: getMessage(response, i18n._('The selected operation could not be loaded.'))
      }));
  };

  goBack = () => {
    if (this.state.operation) {
      this.setState({ operation: null, operationData: null, checks: {}, zeroConfirmed: false, armed: false, error: '' });
    } else if (this.state.configuration) {
      this.setState({ configuration: null, error: '' });
    } else if (this.state.part) {
      this.setState({ part: null, error: '' });
    } else if (this.state.model) {
      this.setState({ model: null, error: '' });
    }
  };

  toggleCheck = index => this.setState(state => ({
    checks: { ...state.checks, [index]: !state.checks[index] },
    armed: false
  }));

  allChecksComplete = () => {
    const operation = this.state.operationData && this.state.operationData.operation;
    return !!operation && operation.checklist.every((item, index) => this.state.checks[index]) && this.state.zeroConfirmed;
  };

  beginArm = event => {
    if (event.type === 'touchstart') {
      this.lastTouchAt = Date.now();
    }
    if (event.type === 'mousedown' && Date.now() - this.lastTouchAt < 700) {
      return;
    }
    if (!this.canArm()) {
      return;
    }
    event.preventDefault();
    this.setState({ armProgress: true });
    this.armTimer = window.setTimeout(() => {
      this.armTimer = null;
      this.verifyAndArm();
    }, 1200);
  };

  verifyAndArm = () => {
    const { model, part, configuration, operation } = this.state;
    api.getGuitarOperation({
      modelId: model.id,
      partId: part.id,
      configurationId: configuration.id,
      operationId: operation.id
    }).then(response => {
      const previousChecksum = this.state.operationData.operation.checksum;
      const next = response.body;
      if (next.operation.checksum !== previousChecksum) {
        this.setState({
          operationData: next,
          armProgress: false,
          armed: false,
          error: i18n._('The G-code changed. Review the updated preview and setup before arming again.')
        });
        return;
      }
      this.setState({ operationData: next, armProgress: false, armed: true, error: '' });
    }).catch(response => this.setState({
      armProgress: false,
      armed: false,
      error: getMessage(response, i18n._('The G-code could not be verified before arming.'))
    }));
  };

  cancelArm = () => {
    if (this.armTimer) {
      window.clearTimeout(this.armTimer);
      this.armTimer = null;
    }
    if (this.state.armProgress) {
      this.setState({ armProgress: false });
    }
  };

  canArm = () => {
    return this.allChecksComplete() &&
      this.state.machineConnected &&
      this.state.socketConnected &&
      this.controllerIsIdle() &&
      this.state.workflowState === 'idle' &&
      this.state.operationData &&
      this.state.operationData.operation.executable;
  };

  startJob = () => {
    const { operationData } = this.state;
    if (!this.state.armed || !this.canArm() || !operationData) {
      return;
    }
    const { selection, operation, gcode } = operationData;
    this.setState({ armed: false, runStarted: false, runFinished: false, error: '' });
    this.abortRequested = false;
    controller.command('gcode:load', operation.gcode, gcode, {
      source: 'guitar-app',
      guitar: selection,
      checksum: operation.checksum
    }, err => {
      if (err) {
        this.setState({ error: i18n._('cncjs could not load the selected G-code.') });
        return;
      }
      controller.command('gcode:start');
      this.setState({ runStarted: true });
      this.saveHistory('started');
      this.requestWakeLock();
    });
  };

  requestWakeLock = () => {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen').catch(() => {});
    }
  };

  saveHistory = status => {
    const data = this.state.operationData;
    if (!data) {
      return;
    }
    let history = [];
    try {
      history = JSON.parse(window.localStorage.getItem('guitar-cnc-history') || '[]');
    } catch (err) {
      history = [];
    }
    history.unshift({
      at: new Date().toISOString(),
      status,
      selection: data.selection,
      checksum: data.operation.checksum
    });
    window.localStorage.setItem('guitar-cnc-history', JSON.stringify(history.slice(0, 100)));
  };

  pause = () => controller.command('gcode:pause');

  resume = () => controller.command('gcode:resume');

  abort = () => {
    this.setState({ confirmation: 'abort' });
  };

  connectMachine = () => {
    if (!this.state.selectedPort || !this.state.socketConnected) {
      return;
    }
    controller.openPort(this.state.selectedPort, { controllerType: 'Grbl', baudrate: 115200 });
  };

  closeMachine = () => controller.closePort(this.state.port);

  homeMachine = () => {
    this.setState({ confirmation: 'home' });
  };

  confirmAction = () => {
    if (this.state.confirmation === 'home') {
      controller.command('homing');
    }
    if (this.state.confirmation === 'abort') {
      this.abortRequested = true;
      controller.command('gcode:stop', { force: true });
      this.saveHistory('aborted');
    }
    this.setState({ confirmation: '' });
  };

  startJog = (event, axis, direction) => {
    if (event.type === 'touchstart') {
      this.lastTouchAt = Date.now();
    }
    if ((event.type === 'mousedown' && Date.now() - this.lastTouchAt < 700) || !this.canJog() || this.activeJog) {
      return;
    }
    event.preventDefault();
    this.activeJog = true;
    this.setState({ jogging: true });
    controller.writeln(`$J=G91 ${axis}${direction * 100} F600`);
  };

  stopJog = () => {
    if (!this.activeJog && !this.state.jogging) {
      return;
    }
    this.activeJog = false;
    controller.command('jogCancel');
    this.setState({ jogging: false });
  };

  canJog = () => this.state.socketConnected && this.state.machineConnected &&
    this.state.workflowState === 'idle' && this.controllerIsIdle();

  controllerIsIdle = () => {
    const status = this.state.controllerState.status || {};
    return String(status.activeState || '').toLowerCase() === 'idle';
  };

  canHome = () => this.state.socketConnected && this.state.machineConnected && this.state.workflowState === 'idle';

  machineStatus = () => {
    const status = this.state.controllerState.status || {};
    return status.activeState || (this.state.machineConnected ? i18n._('Connected') : i18n._('Not connected'));
  };

  renderStatus() {
    const online = this.state.socketConnected && this.state.machineConnected;
    return (
      <button
        type="button"
        className={styles.statusButton}
        onClick={() => this.setState(state => ({ machinePanel: !state.machinePanel }))}
      >
        <span className={classNames(styles.statusDot, { [styles.online]: online })} />
        <span>{this.machineStatus()}</span>
        <i className="fa fa-sliders" aria-hidden="true" />
      </button>
    );
  }

  renderMachinePanel() {
    if (!this.state.machinePanel) {
      return null;
    }
    const status = this.state.controllerState.status || {};
    const wpos = status.wpos || {};
    return (
      <section className={styles.machinePanel} aria-label={i18n._('Machine controls')}>
        <div className={styles.panelHeader}>
          <div>
            <span className={styles.eyebrow}>{i18n._('GRBL controller')}</span>
            <h2>{this.machineStatus()}</h2>
          </div>
          <button
            type="button" className={styles.iconButton} onClick={() => this.setState({ machinePanel: false })}
            aria-label={i18n._('Close')}
          >
            <i className="fa fa-times" aria-hidden="true" />
          </button>
        </div>
        {!this.state.machineConnected ? (
          <div>
            <label className={styles.fieldLabel} htmlFor="guitar-cnc-port">{i18n._('Serial port')}</label>
            <select
              id="guitar-cnc-port"
              value={this.state.selectedPort}
              onChange={event => this.setState({ selectedPort: event.target.value })}
            >
              <option value="">{i18n._('Choose a port')}</option>
              {this.state.ports.map(item => (
                <option key={item.port} value={item.port}>{item.port}</option>
              ))}
            </select>
            <button
              type="button" className={styles.primaryButton} disabled={!this.state.selectedPort}
              onClick={this.connectMachine}
            >
              {i18n._('Connect at 115200')}
            </button>
          </div>
        ) : (
          <div>
            <div className={styles.coordinates}>
              <span>X <strong>{Number(wpos.x || 0).toFixed(3)}</strong></span>
              <span>Y <strong>{Number(wpos.y || 0).toFixed(3)}</strong></span>
              <span>Z <strong>{Number(wpos.z || 0).toFixed(3)}</strong></span>
            </div>
            <div className={styles.jogGrid}>
              <button
                type="button" onMouseDown={event => this.startJog(event, 'Y', 1)} onMouseUp={this.stopJog}
                onMouseLeave={this.stopJog} onTouchStart={event => this.startJog(event, 'Y', 1)} onTouchEnd={this.stopJog}
                onTouchCancel={this.stopJog}
              >Y+
              </button>
              <button
                type="button" onMouseDown={event => this.startJog(event, 'Z', 1)} onMouseUp={this.stopJog}
                onMouseLeave={this.stopJog} onTouchStart={event => this.startJog(event, 'Z', 1)} onTouchEnd={this.stopJog}
                onTouchCancel={this.stopJog}
              >Z+
              </button>
              <button
                type="button" onMouseDown={event => this.startJog(event, 'X', -1)} onMouseUp={this.stopJog}
                onMouseLeave={this.stopJog} onTouchStart={event => this.startJog(event, 'X', -1)} onTouchEnd={this.stopJog}
                onTouchCancel={this.stopJog}
              >X−
              </button>
              <button type="button" className={styles.jogStop} onClick={this.stopJog}>{i18n._('Stop')}</button>
              <button
                type="button" onMouseDown={event => this.startJog(event, 'X', 1)} onMouseUp={this.stopJog}
                onMouseLeave={this.stopJog} onTouchStart={event => this.startJog(event, 'X', 1)} onTouchEnd={this.stopJog}
                onTouchCancel={this.stopJog}
              >X+
              </button>
              <button
                type="button" onMouseDown={event => this.startJog(event, 'Y', -1)} onMouseUp={this.stopJog}
                onMouseLeave={this.stopJog} onTouchStart={event => this.startJog(event, 'Y', -1)} onTouchEnd={this.stopJog}
                onTouchCancel={this.stopJog}
              >Y−
              </button>
              <button
                type="button" onMouseDown={event => this.startJog(event, 'Z', -1)} onMouseUp={this.stopJog}
                onMouseLeave={this.stopJog} onTouchStart={event => this.startJog(event, 'Z', -1)} onTouchEnd={this.stopJog}
                onTouchCancel={this.stopJog}
              >Z−
              </button>
            </div>
            <p className={styles.helpText}>{i18n._('Press and hold to jog. Releasing your finger cancels motion.')}</p>
            <div className={styles.buttonRow}>
              <button
                type="button" className={styles.secondaryButton} disabled={!this.canHome()}
                onClick={this.homeMachine}
              >{i18n._('Home')}
              </button>
              <button type="button" className={styles.textButton} onClick={this.closeMachine}>{i18n._('Disconnect')}</button>
            </div>
          </div>
        )}
      </section>
    );
  }

  renderConfirmation() {
    const action = this.state.confirmation;
    if (!action) {
      return null;
    }
    const aborting = action === 'abort';
    return (
      <div className={styles.confirmationBackdrop} role="presentation">
        <section className={styles.confirmation} role="alertdialog" aria-modal="true">
          <span className={styles.eyebrow}>{aborting ? i18n._('Stop operation') : i18n._('Machine motion')}</span>
          <h2>{aborting ? i18n._('Abort the current operation?') : i18n._('Home the machine now?')}</h2>
          <p>
            {aborting
              ? i18n._('The machine will stop and this job will not resume automatically.')
              : i18n._('Make sure the machine and its full travel are clear.')}
          </p>
          <div className={styles.confirmationActions}>
            <button type="button" className={styles.textButton} onClick={() => this.setState({ confirmation: '' })}>{i18n._('Cancel')}</button>
            <button type="button" className={aborting ? styles.abortButton : styles.primaryButton} onClick={this.confirmAction}>
              {aborting ? i18n._('Abort now') : i18n._('Home machine')}
            </button>
          </div>
        </section>
      </div>
    );
  }

  renderCards(items, onSelect, emptyMessage) {
    if (!items.length) {
      return <div className={styles.emptyState}><i className="fa fa-folder-open-o" aria-hidden="true" /><p>{emptyMessage}</p></div>;
    }
    return (
      <div className={styles.cardGrid}>
        {items.map(item => (
          <button
            key={item.id} type="button" className={styles.choiceCard}
            onClick={() => onSelect(item)}
          >
            <span className={styles.choiceName}>{item.name}</span>
            {item.description && <span className={styles.choiceDescription}>{item.description}</span>}
            <i className="fa fa-angle-right" aria-hidden="true" />
          </button>
        ))}
      </div>
    );
  }

  renderRunScreen() {
    const progress = percent(this.state.sender.sent, this.state.sender.total);
    const paused = this.state.workflowState === 'paused';
    const selection = this.state.operationData && this.state.operationData.selection;
    return (
      <main className={styles.runScreen}>
        <div className={styles.runRing} style={{ background: `conic-gradient(#ef9b50 ${progress}%, #263238 ${progress}%)` }}>
          <div><strong>{progress}%</strong><span>{paused ? i18n._('Paused') : i18n._('Cutting')}</span></div>
        </div>
        <span className={styles.eyebrow}>
          {selection ? `${selection.modelName} · ${selection.partName}` : i18n._('Active cncjs job')}
        </span>
        <h1>{selection ? selection.operationName : (this.state.sender.name || i18n._('Machine operation'))}</h1>
        <p>{this.state.sender.sent || 0} / {this.state.sender.total || 0} {i18n._('lines')}</p>
        <div className={styles.runActions}>
          {paused ? (
            <button type="button" className={styles.primaryButton} onClick={this.resume}><i className="fa fa-play" aria-hidden="true" /> {i18n._('Resume')}</button>
          ) : (
            <button type="button" className={styles.pauseButton} onClick={this.pause}><i className="fa fa-pause" aria-hidden="true" /> {i18n._('Pause')}</button>
          )}
          <button type="button" className={styles.abortButton} onClick={this.abort}><i className="fa fa-stop" aria-hidden="true" /> {i18n._('Abort')}</button>
        </div>
        {this.renderConfirmation()}
      </main>
    );
  }

  renderOperation() {
    const data = this.state.operationData;
    if (!data) {
      return null;
    }
    const operation = data.operation;
    const executable = operation.executable;
    return (
      <div>
        <section className={styles.toolpathCard}>
          <div className={styles.toolpathHeader}>
            <div><span className={styles.eyebrow}>{i18n._('Actual G-code preview')}</span><h2>{operation.name}</h2></div>
            <span className={styles.fileSize}>{Math.max(1, Math.round(operation.size / 1024))} KB</span>
          </div>
          <div className={styles.toolpathCanvas}><GCodePreview gcode={data.gcode} /></div>
          <div className={styles.fileMeta}>
            <span>{operation.gcode}</span>
            <code>{operation.checksum.slice(0, 12)}</code>
          </div>
        </section>

        {!executable && (
          <div className={styles.warning} role="alert">
            <i className="fa fa-lock" aria-hidden="true" />
            <div><strong>{i18n._('Preview only')}</strong><p>{i18n._('This sample operation is locked. Replace it with approved shop G-code and explicitly enable it in the manifest.')}</p></div>
          </div>
        )}

        <section className={styles.setupCard}>
          <span className={styles.eyebrow}>{i18n._('Setup')}</span>
          <h2>{operation.tool}</h2>
          {operation.description && <p>{operation.description}</p>}
          {operation.checklist.map((item, index) => (
            <label key={item} className={styles.checkRow}>
              <input type="checkbox" checked={!!this.state.checks[index]} onChange={() => this.toggleCheck(index)} />
              <span className={styles.customCheck}><i className="fa fa-check" aria-hidden="true" /></span>
              <span>{item}</span>
            </label>
          ))}
          <label className={styles.checkRow}>
            <input type="checkbox" checked={this.state.zeroConfirmed} onChange={() => this.setState(state => ({ zeroConfirmed: !state.zeroConfirmed, armed: false }))} />
            <span className={styles.customCheck}><i className="fa fa-check" aria-hidden="true" /></span>
            <span>{operation.workZero || i18n._('Work zero has been verified for this operation')}</span>
          </label>
        </section>

        <div className={styles.armArea}>
          {!this.state.armed ? (
            <button
              type="button"
              className={classNames(styles.armButton, { [styles.arming]: this.state.armProgress })}
              disabled={!this.canArm()}
              onMouseDown={this.beginArm}
              onMouseUp={this.cancelArm}
              onMouseLeave={this.cancelArm}
              onTouchStart={this.beginArm}
              onTouchEnd={this.cancelArm}
              onTouchCancel={this.cancelArm}
            >
              <i className="fa fa-hand-pointer-o" aria-hidden="true" />
              {this.state.armProgress ? i18n._('Keep holding…') : i18n._('Hold to arm')}
            </button>
          ) : (
            <button type="button" className={styles.startButton} onClick={this.startJob}>
              <i className="fa fa-play" aria-hidden="true" /> {i18n._('Start operation')}
            </button>
          )}
          {!this.state.machineConnected && <p>{i18n._('Connect the machine to unlock arming.')}</p>}
        </div>
      </div>
    );
  }

  renderContent() {
    const { model, part, configuration, operation } = this.state;
    if (operation) {
      return this.renderOperation();
    }
    if (configuration) {
      return (
        <section>
          <span className={styles.eyebrow}>{configuration.name}</span>
          <h1>{i18n._('Choose an operation')}</h1>
          {this.renderCards(configuration.operations, this.selectOperation, i18n._('No approved operations have been added yet.'))}
        </section>
      );
    }
    if (part) {
      return (
        <section>
          <span className={styles.eyebrow}>{model.name} · {part.name}</span>
          <h1>{i18n._('Choose a configuration')}</h1>
          {this.renderCards(part.configurations, this.selectConfiguration, i18n._('No configurations have been added yet.'))}
        </section>
      );
    }
    if (model) {
      return (
        <section>
          <span className={styles.eyebrow}>{model.name}</span>
          <h1>{i18n._('What are you making?')}</h1>
          {this.renderCards(model.parts, this.selectPart, i18n._('This guitar is not configured yet.'))}
        </section>
      );
    }
    return (
      <section>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>{i18n._('Guitar CNC')}</span>
          <h1>{i18n._('Choose your build')}</h1>
          <p>{i18n._('Select a guitar to begin a guided setup.')}</p>
        </div>
        {this.renderCards(this.state.catalog.models, this.selectModel, i18n._('No guitar models are available.'))}
      </section>
    );
  }

  render() {
    if (['running', 'paused'].includes(this.state.workflowState)) {
      return this.renderRunScreen();
    }
    const { model, part, configuration } = this.state;
    return (
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.brand}>
            {(model || part || configuration) ? (
              <button
                type="button" className={styles.iconButton} onClick={this.goBack}
                aria-label={i18n._('Go back')}
              >
                <i className="fa fa-angle-left" aria-hidden="true" />
              </button>
            ) : <span className={styles.brandMark}>G</span>}
            <div><strong>Grit</strong><span>{i18n._('Guitar CNC')}</span></div>
          </div>
          {this.renderStatus()}
        </header>

        <div className={styles.preview}>
          <GuitarPreview
            accent={(model && model.accent) || '#e96a3a'}
            part={part && part.name}
            pickupLayout={configuration && configuration.pickupLayout}
          />
          <span className={styles.dragHint}><i className="fa fa-hand-rock-o" aria-hidden="true" /> {i18n._('Drag to rotate')}</span>
        </div>

        <main className={styles.main}>
          {this.state.error && <div className={styles.error} role="alert">{this.state.error}</div>}
          {this.state.loading ? <div className={styles.loading}>{i18n._('Loading…')}</div> : this.renderContent()}
          {!model && (
            <div className={styles.utilityLinks}>
              {this.state.installPrompt && <button type="button" onClick={this.installApp}><i className="fa fa-mobile" aria-hidden="true" /> {i18n._('Install on this phone')}</button>}
              <Link to="/workspace"><i className="fa fa-wrench" aria-hidden="true" /> {i18n._('Open cncjs workspace')}</Link>
            </div>
          )}
        </main>
        {this.renderMachinePanel()}
        {this.renderConfirmation()}
      </div>
    );
  }
}

export default Guitar;
