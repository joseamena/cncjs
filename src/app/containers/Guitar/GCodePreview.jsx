import Toolpath from 'gcode-toolpath';
import PropTypes from 'prop-types';
import React, { PureComponent } from 'react';

const colors = {
  G0: '#7e8b92',
  G1: '#f0a454',
  G2: '#52c4b8',
  G3: '#52c4b8'
};

class GCodePreview extends PureComponent {
  static propTypes = {
    gcode: PropTypes.string
  };

  canvas = null;

  componentDidMount() {
    this.draw();
    window.addEventListener('resize', this.draw);
  }

  componentDidUpdate() {
    this.draw();
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.draw);
  }

  setRef = (canvas) => {
    this.canvas = canvas;
  };

  parse = () => {
    const segments = [];
    const addSegment = (modal, v1, v2) => {
      segments.push({ motion: modal.motion, a: v1, b: v2 });
    };
    const toolpath = new Toolpath({
      addLine: addSegment,
      addArcCurve: (modal, v1, v2, center) => {
        const clockwise = modal.motion === 'G2';
        const radius = Math.sqrt(((v1.x - center.x) ** 2) + ((v1.y - center.y) ** 2));
        let start = Math.atan2(v1.y - center.y, v1.x - center.x);
        let end = Math.atan2(v2.y - center.y, v2.x - center.x);
        if (clockwise && end > start) {
          end -= Math.PI * 2;
        }
        if (!clockwise && end < start) {
          end += Math.PI * 2;
        }
        const previous = { x: v1.x, y: v1.y };
        for (let index = 1; index <= 32; ++index) {
          const angle = start + ((end - start) * index / 32);
          const next = { x: center.x + (Math.cos(angle) * radius), y: center.y + (Math.sin(angle) * radius) };
          addSegment(modal, { ...previous }, next);
          previous.x = next.x;
          previous.y = next.y;
        }
      }
    });
    toolpath.loadFromStringSync(this.props.gcode || '');
    return segments;
  };

  draw = () => {
    if (!this.canvas) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    const context = this.canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    const segments = this.parse();
    if (!segments.length) {
      return;
    }
    const points = segments.reduce((all, segment) => all.concat([segment.a, segment.b]), []);
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const bounds = {
      minX: Math.min.apply(null, xs),
      maxX: Math.max.apply(null, xs),
      minY: Math.min.apply(null, ys),
      maxY: Math.max.apply(null, ys)
    };
    const padding = 20;
    const scale = Math.min(
      (width - (padding * 2)) / Math.max(bounds.maxX - bounds.minX, 1),
      (height - (padding * 2)) / Math.max(bounds.maxY - bounds.minY, 1)
    );
    const project = point => ({
      x: padding + ((point.x - bounds.minX) * scale),
      y: height - padding - ((point.y - bounds.minY) * scale)
    });

    context.lineWidth = 1.5;
    context.lineCap = 'round';
    segments.forEach(segment => {
      const a = project(segment.a);
      const b = project(segment.b);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.strokeStyle = colors[segment.motion] || '#d8dee1';
      context.stroke();
    });
  };

  render() {
    return <canvas ref={this.setRef} aria-label="Parsed G-code toolpath preview" />;
  }
}

export default GCodePreview;
