import * as dat from 'dat.gui';
import * as PIXI from 'pixi.js';
import * as FontGeometryGenerator from './FontGeometryGenerator';

const loadFont = require('load-bmfont');
const createLayout = require('layout-bmfont-text');
const createIndices = require('quad-indices');

const gui = new dat.GUI();

const guiParams = {
  drawUV: false,
  drawDistance: false,
  scale: 1,
  buffer: 0.3,
  outlineSize: 0.2,
};

const app = new PIXI.Application({
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: 0x888888,
});
document.body.appendChild(app.view);

init();

async function init() {
  const font = await loadFNT();

  const mesh = createTextMesh();
  updateText(font, mesh.geometry);

  mesh.position.set(
    app.screen.width / 2 - mesh.width / 2,
    app.screen.height / 2
  );
  app.stage.addChild(mesh);

  app.ticker.add(() => {
    updateText(font, mesh.geometry);
    mesh.material.uniforms.drawUV = guiParams.drawUV;
    mesh.material.uniforms.drawDistance = guiParams.drawDistance;
    mesh.material.uniforms.smoothing = 0.1 / guiParams.scale;
    mesh.material.uniforms.buffer = guiParams.buffer;
    mesh.material.uniforms.outlineSize = guiParams.outlineSize;
    mesh.scale.set(guiParams.scale, guiParams.scale);
    mesh.position.set(
      app.screen.width / 2 - mesh.width / 2,
      app.screen.height / 2
    );
  });

  gui.add(guiParams, 'drawUV').name('Show UV');
  gui.add(guiParams, 'drawDistance').name('Show distance field');
  gui.add(guiParams, 'scale', 0.1, 10).name('Viewport scale');
  gui.add(guiParams, 'buffer', 0, 0.5).name('SDF buffer');
  gui.add(guiParams, 'outlineSize', 0, 1).name('Outline width');
}

async function loadFNT() {
  return new Promise((resolve) => {
    loadFont('roboto.fnt', (error, font) => {
      resolve(font);
    });
  });
}

function createTextMesh() {
  const geometry = new PIXI.Geometry();

  geometry.addAttribute('position', new Float32Array(), 2);
  geometry.addAttribute('uv', new Float32Array(), 2);
  geometry.addAttribute('scale', new Float32Array(), 2);
  geometry.addAttribute('offset', new Float32Array(), 2);
  geometry.addIndex(new Uint16Array());

  const vert = `
	precision mediump float;
	attribute vec2 position;
	attribute vec2 uv;
	attribute vec2 offset;
	attribute vec2 scale;

	varying vec2 vUv;
	varying float vScale;

	uniform mat3 translationMatrix;
	uniform mat3 projectionMatrix;

	void main() {
		vUv = uv;
		vScale = scale.x;
		vec2 transformedPosition = position * scale + offset;
		gl_Position = vec4((projectionMatrix * translationMatrix * vec3(transformedPosition, 1.0)).xy, 0.0, 1.0);
	}`;

  const frag = `
	precision mediump float;

	varying vec2 vUv;
	varying float vScale;

	uniform sampler2D tSDF;
	uniform bool drawUV;
	uniform bool drawDistance;

	uniform vec3 textColor;
	uniform vec3 outlineColor;
	uniform float buffer;
	uniform float opacity;
	uniform float outlineSize;
	uniform float smoothing;

	void main() {
	    float fixedSmoothing = smoothing / vScale;

		float distance = texture2D(tSDF, vUv).a;
		float alpha = smoothstep(buffer - fixedSmoothing, buffer + fixedSmoothing, distance);
		float border = smoothstep(buffer + outlineSize - fixedSmoothing, buffer + outlineSize + fixedSmoothing, distance);
		gl_FragColor = vec4(mix(outlineColor, textColor, border), 1.) * alpha * opacity;

		if(drawUV) gl_FragColor = vec4(vUv, 0, 1);
		if(drawDistance) gl_FragColor = vec4(distance);
	}
	`;

  const material = PIXI.Shader.from(vert, frag, {
    tSDF: PIXI.Texture.from('roboto.png'),
    textColor: [1, 1, 1],
    outlineColor: [0.1, 0.1, 0.1],
    smoothing: 0.1,
    buffer: 0.1,
    outlineSize: 0.1,
    opacity: 1,
    drawUV: false,
    drawDistance: false,
  });

  return new PIXI.Mesh(geometry, material);
}

const strings = Array.from({ length: 100 }, () =>
  Math.random().toString(16).slice(2, 5)
);

function updateText(font, geometry) {
  const offsets = [],
    scales = [];

  const time = performance.now() / 1000;

  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 10; y++) {
      offsets.push([(x - 5) * 80, (y - 5) * 64]);
      scales.push([
        Math.sin(time + x) * 0.25 + 1,
        Math.cos(time + y) * 0.25 + 1,
      ]);
    }
  }

  const attributes = buildMergedText(font, strings, offsets, scales);

  geometry.getBuffer('position').update(attributes.positions);
  geometry.getBuffer('uv').update(attributes.uvs);
  geometry.getBuffer('scale').update(attributes.scales);
  geometry.getBuffer('offset').update(attributes.offsets);
  geometry.getIndex().update(attributes.indices);
}

function createTextAttributes(font, text) {
  const layout = createLayout({
    font,
    text: text,
    letterSpacing: 1,
    align: 'left',
  });

  const positions = FontGeometryGenerator.getPositions(layout.glyphs);
  const uvs = FontGeometryGenerator.getUvs(layout.glyphs, 512, 256, false);
  const indices = new Uint16Array(
    createIndices([], {
      clockwise: true,
      type: 'uint16',
      count: layout.glyphs.length,
    })
  );

  return { positions, uvs, indices };
}

function buildMergedText(font, textArray, offsets, scales) {
  const positionsArrays = [];
  const uvsArrays = [];
  const indicesArrays = [];
  const offsetsArrays = [];
  const scalesArrays = [];

  let maxIndex = 0;

  for (let i = 0; i < textArray.length; i++) {
    const attributeCollection = createTextAttributes(font, textArray[i]);
    const vertexCount = attributeCollection.positions.length / 2;

    for (let i = 0; i < attributeCollection.indices.length; i++) {
      attributeCollection.indices[i] += maxIndex;
    }

    maxIndex += vertexCount;

    positionsArrays.push(attributeCollection.positions);
    uvsArrays.push(attributeCollection.uvs);
    indicesArrays.push(attributeCollection.indices);

    const offsetsBuffer = fillTypedArraySequence(
      new Float32Array(vertexCount * 2),
      new Float32Array(offsets[i])
    );
    const scalesBuffer = fillTypedArraySequence(
      new Float32Array(vertexCount * 2),
      new Float32Array(scales[i])
    );
    offsetsArrays.push(offsetsBuffer);
    scalesArrays.push(scalesBuffer);
  }

  const mergedPositions = mergeTypedArrays(positionsArrays);
  const mergedUvs = mergeTypedArrays(uvsArrays);
  const mergedIndices = mergeTypedArrays(indicesArrays);
  const mergedOffsets = mergeTypedArrays(offsetsArrays);
  const mergedScales = mergeTypedArrays(scalesArrays);

  return {
    positions: mergedPositions,
    uvs: mergedUvs,
    indices: mergedIndices,
    offsets: mergedOffsets,
    scales: mergedScales,
  };
}

function mergeTypedArrays(typedArrays) {
  let length = 0;

  for (let i = 0; i < typedArrays.length; i++) {
    length += typedArrays[i].length;
  }

  const array = new typedArrays[0].constructor(length);

  let currentLength = 0;

  for (let i = 0; i < typedArrays.length; i++) {
    array.set(typedArrays[i], currentLength);
    currentLength += typedArrays[i].length;
  }

  return array;
}

function fillTypedArraySequence(typedArray, sequence) {
  const length = typedArray.length;
  let sequenceLength = sequence.length;
  let position = sequenceLength;

  typedArray.set(sequence);

  while (position < length) {
    if (position + sequenceLength > length) sequenceLength = length - position;
    typedArray.copyWithin(position, 0, sequenceLength);
    position += sequenceLength;
    sequenceLength <<= 1;
  }

  return typedArray;
}
