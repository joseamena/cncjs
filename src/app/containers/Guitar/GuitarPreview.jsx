import PropTypes from 'prop-types';
import React, { PureComponent } from 'react';
import ReactDOM from 'react-dom';
import * as THREE from 'three';

class GuitarPreview extends PureComponent {
  static propTypes = {
    accent: PropTypes.string,
    part: PropTypes.string,
    pickupLayout: PropTypes.string
  };

  node = null;

  renderer = null;

  scene = null;

  camera = null;

  guitar = null;

  frame = null;

  dragging = false;

  pointer = { x: 0, y: 0 };

  eventPoint = (event) => {
    const touch = event.touches && event.touches[0];
    return touch || event;
  };

  componentDidMount() {
    this.createScene();
    window.addEventListener('resize', this.resize);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.accent !== this.props.accent ||
        prevProps.part !== this.props.part ||
        prevProps.pickupLayout !== this.props.pickupLayout) {
      this.buildGuitar();
    }
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.resize);
    cancelAnimationFrame(this.frame);
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  setRef = (node) => {
    this.node = node;
  };

  createScene = () => {
    const node = ReactDOM.findDOMNode(this.node);
    if (!node) {
      return;
    }

    try {
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      this.camera.position.set(0, -0.3, 10);
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      node.appendChild(this.renderer.domElement);

      const ambient = new THREE.AmbientLight(0xffffff, 0.75);
      const key = new THREE.DirectionalLight(0xffffff, 0.8);
      key.position.set(-3, 5, 8);
      this.scene.add(ambient);
      this.scene.add(key);
      this.buildGuitar();
      this.resize();
      this.renderScene();
    } catch (err) {
      node.setAttribute('data-webgl-unavailable', 'true');
    }
  };

  buildGuitar = () => {
    if (!this.scene) {
      return;
    }
    if (this.guitar) {
      this.scene.remove(this.guitar);
    }

    const accent = new THREE.Color(this.props.accent || '#e96a3a');
    const group = new THREE.Group();
    const bodyShape = new THREE.Shape();
    bodyShape.moveTo(0, -3.15);
    bodyShape.bezierCurveTo(-0.8, -3.15, -1.65, -2.65, -1.52, -1.72);
    bodyShape.bezierCurveTo(-1.4, -0.92, -0.82, -0.8, -0.72, -0.15);
    bodyShape.bezierCurveTo(-0.65, 0.38, -1.1, 0.58, -0.92, 1.2);
    bodyShape.bezierCurveTo(-0.48, 1.02, -0.2, 0.86, 0, 0.58);
    bodyShape.bezierCurveTo(0.2, 0.86, 0.48, 1.02, 0.92, 1.2);
    bodyShape.bezierCurveTo(1.1, 0.58, 0.65, 0.38, 0.72, -0.15);
    bodyShape.bezierCurveTo(0.82, -0.8, 1.4, -0.92, 1.52, -1.72);
    bodyShape.bezierCurveTo(1.65, -2.65, 0.8, -3.15, 0, -3.15);

    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(bodyShape, { amount: 0.34, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 }),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.48, metalness: 0.08 })
    );
    body.position.z = -0.15;
    body.name = 'Body';
    group.add(body);

    const neckMaterial = new THREE.MeshStandardMaterial({ color: 0xc89b62, roughness: 0.7 });
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.48, 4.7, 0.2), neckMaterial);
    neck.position.set(0, 3.3, 0.12);
    neck.name = 'Neck';
    group.add(neck);

    const headstock = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.15, 0.22), neckMaterial);
    headstock.position.set(0.12, 6.05, 0.12);
    headstock.rotation.z = -0.08;
    headstock.name = 'Neck';
    group.add(headstock);

    const pickupMaterial = new THREE.MeshStandardMaterial({ color: 0x161819, roughness: 0.3 });
    const layout = this.props.pickupLayout || 'HH';
    const pickupCount = layout === 'SSS' ? 3 : 2;
    for (let i = 0; i < pickupCount; ++i) {
      const pickup = new THREE.Mesh(
        new THREE.BoxGeometry(layout === 'SSS' ? 0.95 : 1.18, 0.25, 0.16),
        pickupMaterial
      );
      pickup.position.set(0, 0.12 - (i * 0.58), 0.37);
      pickup.name = 'Pickups';
      group.add(pickup);
    }

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 0.13), new THREE.MeshStandardMaterial({ color: 0xb8bec2, metalness: 0.8, roughness: 0.25 }));
    bridge.position.set(0, -1.35, 0.38);
    group.add(bridge);

    group.children.forEach(child => {
      if (this.props.part && child.name && child.name !== this.props.part && child.material) {
        child.material = child.material.clone();
        child.material.opacity = 0.28;
        child.material.transparent = true;
      }
    });

    // Center the model around its rotation pivot so it remains framed while
    // dragging instead of orbiting around the original drawing origin.
    group.updateMatrixWorld(true);
    const modelCenter = new THREE.Box3()
      .setFromObject(group)
      .getCenter(new THREE.Vector3());
    group.children.forEach(child => child.position.sub(modelCenter));

    group.rotation.x = -0.06;
    group.rotation.y = -0.16;
    group.scale.set(0.72, 0.72, 0.72);
    this.guitar = group;
    this.scene.add(group);
    this.fitCamera();
  };

  fitCamera = () => {
    if (!this.camera || !this.guitar) {
      return;
    }

    this.guitar.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.guitar);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const verticalFov = this.camera.fov * Math.PI / 180;
    const distanceForHeight = size.y / (2 * Math.tan(verticalFov / 2));
    const distanceForWidth = size.x / (
      2 * Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, 0.01)
    );
    const distance = Math.max(distanceForHeight, distanceForWidth) * 1.16;

    this.camera.position.set(center.x, center.y, center.z + distance);
    this.camera.near = Math.max(distance / 100, 0.01);
    this.camera.far = distance * 10;
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
  };

  resize = () => {
    const node = ReactDOM.findDOMNode(this.node);
    if (!node || !this.renderer) {
      return;
    }
    const width = node.clientWidth;
    const height = node.clientHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    // Let Three set the CSS size as well as the high-DPI drawing buffer. With
    // `false`, the 2x pixel-ratio canvas was twice as wide and got clipped.
    this.renderer.setSize(width, height);
    this.fitCamera();
  };

  renderScene = () => {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
    this.frame = requestAnimationFrame(this.renderScene);
  };

  pointerDown = (event) => {
    this.dragging = true;
    const point = this.eventPoint(event);
    this.pointer = { x: point.clientX, y: point.clientY };
  };

  pointerMove = (event) => {
    if (!this.dragging || !this.guitar) {
      return;
    }
    event.preventDefault();
    const point = this.eventPoint(event);
    const dx = point.clientX - this.pointer.x;
    const dy = point.clientY - this.pointer.y;
    this.guitar.rotation.y += dx * 0.008;
    this.guitar.rotation.x += dy * 0.005;
    this.pointer = { x: point.clientX, y: point.clientY };
  };

  pointerUp = () => {
    this.dragging = false;
  };

  render() {
    return (
      <button
        type="button"
        ref={this.setRef}
        aria-label="Interactive guitar preview"
        onMouseDown={this.pointerDown}
        onMouseMove={this.pointerMove}
        onMouseUp={this.pointerUp}
        onMouseLeave={this.pointerUp}
        onTouchStart={this.pointerDown}
        onTouchMove={this.pointerMove}
        onTouchEnd={this.pointerUp}
        onTouchCancel={this.pointerUp}
      />
    );
  }
}

export default GuitarPreview;
