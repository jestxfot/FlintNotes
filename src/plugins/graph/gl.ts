/** Numbers per link in the buffer: both ends, a colour with its opacity, and the radius of the dot it points to. */
export const LINK_SIZE = 9
/** Numbers per dot: centre, radius, colour with opacity. */
export const NODE_SIZE = 7

export interface Frame {
  /** Size of the canvas in CSS pixels, and device pixels per CSS pixel. */
  width: number
  height: number
  ratio: number
  /** screen = graph * k + (x, y), measured from the canvas centre. */
  view: { x: number; y: number; k: number }
  links: Float32Array
  linkCount: number
  nodes: Float32Array
  nodeCount: number
  /** Width of a line in CSS pixels. */
  lineWidth: number
  arrows: boolean
}

const HEAD = `#version 300 es
precision highp float;
uniform vec2 u_size;
uniform vec3 u_view;
vec4 place(vec2 world) {
  vec2 screen = world * u_view.z + u_view.xy;
  return vec4(screen.x * 2.0 / u_size.x, -screen.y * 2.0 / u_size.y, 0.0, 1.0);
}
`

// A link is a thin rectangle from one end to the other, widened across its direction.
const LINE_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_from;
layout(location = 2) in vec2 a_to;
layout(location = 3) in vec4 a_color;
uniform float u_half;
out vec4 v_color;
void main() {
  vec2 along = a_to - a_from;
  float len = max(length(along), 0.0001);
  vec2 across = vec2(-along.y, along.x) / len;
  gl_Position = place(mix(a_from, a_to, a_corner.x) + across * a_corner.y * u_half / u_view.z);
  v_color = a_color;
}`

// An arrowhead is a triangle whose tip touches the edge of the dot the link points to.
const ARROW_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 a_from;
layout(location = 2) in vec2 a_to;
layout(location = 3) in vec4 a_color;
layout(location = 4) in float a_radius;
uniform float u_length;
out vec4 v_color;
void main() {
  vec2 along = a_to - a_from;
  float len = max(length(along), 0.0001);
  vec2 dir = along / len;
  vec2 across = vec2(-dir.y, dir.x);
  float size = u_length / u_view.z;
  vec2 tip = a_to - dir * (a_radius + 1.0 / u_view.z);
  gl_Position = place(tip - dir * size * a_corner.x + across * size * 0.45 * a_corner.y);
  // A link shorter than its own arrowhead gets none.
  v_color = len > a_radius + size * 1.5 ? a_color : vec4(0.0);
}`

const FLAT_FS = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 color;
void main() {
  color = vec4(v_color.rgb * v_color.a, v_color.a);
}`

// A dot is a square with a circle cut out of it by the fragment shader, its edge smoothed over one pixel.
const NODE_VS = `${HEAD}
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec3 a_dot;
layout(location = 2) in vec4 a_color;
out vec4 v_color;
out vec2 v_local;
out float v_edge;
void main() {
  float radius = a_dot.z + 1.0 / u_view.z;
  gl_Position = place(a_dot.xy + a_corner * radius);
  v_local = a_corner;
  // One screen pixel, in the square's own units.
  v_edge = 1.0 / max(radius * u_view.z, 0.5);
  v_color = a_color;
}`

const NODE_FS = `#version 300 es
precision highp float;
in vec4 v_color;
in vec2 v_local;
in float v_edge;
out vec4 color;
void main() {
  float alpha = v_color.a * (1.0 - smoothstep(1.0 - v_edge * 1.5, 1.0, length(v_local)));
  color = vec4(v_color.rgb * alpha, alpha);
}`

/**
 * Draws the graph's lines and dots with WebGL: every link and every dot is one
 * instance of a small shape, placed and coloured by the graphics card. Ten
 * thousand links cost one draw call instead of ten thousand strokes.
 */
export class GlRenderer {
  private programs: { line: WebGLProgram; arrow: WebGLProgram; node: WebGLProgram }
  private buffers: { quad: WebGLBuffer; strip: WebGLBuffer; triangle: WebGLBuffer; links: WebGLBuffer; nodes: WebGLBuffer }
  private arrays: { line: WebGLVertexArrayObject; arrow: WebGLVertexArrayObject; node: WebGLVertexArrayObject }

  /** A renderer for the canvas, or `null` where WebGL 2 is not to be had (the caller then draws in 2D). */
  static create(canvas: HTMLCanvasElement): GlRenderer | null {
    try {
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true })
      return gl ? new GlRenderer(gl) : null
    } catch {
      return null
    }
  }

  private constructor(readonly gl: WebGL2RenderingContext) {
    const program = (vs: string, fs: string) => {
      const made = gl.createProgram()!
      for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
        const shader = gl.createShader(type)!
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
        gl.attachShader(made, shader)
      }
      gl.linkProgram(made)
      if (!gl.getProgramParameter(made, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(made) ?? 'program')
      return made
    }
    const buffer = (data?: number[]) => {
      const made = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, made)
      if (data) gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
      return made
    }
    this.programs = { line: program(LINE_VS, FLAT_FS), arrow: program(ARROW_VS, FLAT_FS), node: program(NODE_VS, NODE_FS) }
    this.buffers = {
      // The shapes one instance is made of: a rectangle along a link, a square around a dot, a triangle.
      strip: buffer([0, -1, 1, -1, 0, 1, 1, 1]),
      quad: buffer([-1, -1, 1, -1, -1, 1, 1, 1]),
      triangle: buffer([0, 0, 1, 1, 1, -1]),
      links: buffer(),
      nodes: buffer(),
    }
    const array = (shape: WebGLBuffer, instances: WebGLBuffer, stride: number, layout: [location: number, size: number, offset: number][]) => {
      const made = gl.createVertexArray()!
      gl.bindVertexArray(made)
      gl.bindBuffer(gl.ARRAY_BUFFER, shape)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, instances)
      for (const [location, size, offset] of layout) {
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4)
        gl.vertexAttribDivisor(location, 1)
      }
      gl.bindVertexArray(null)
      return made
    }
    const link: [number, number, number][] = [[1, 2, 0], [2, 2, 2], [3, 4, 4]]
    this.arrays = {
      line: array(this.buffers.strip, this.buffers.links, LINK_SIZE, link),
      arrow: array(this.buffers.triangle, this.buffers.links, LINK_SIZE, [...link, [4, 1, 8]]),
      node: array(this.buffers.quad, this.buffers.nodes, NODE_SIZE, [[1, 3, 0], [2, 4, 3]]),
    }
    gl.enable(gl.BLEND)
    // Colours leave the shaders multiplied by their opacity.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  draw(frame: Frame): void {
    const { gl } = this
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const use = (program: WebGLProgram) => {
      gl.useProgram(program)
      gl.uniform2f(gl.getUniformLocation(program, 'u_size'), frame.width, frame.height)
      gl.uniform3f(gl.getUniformLocation(program, 'u_view'), frame.view.x, frame.view.y, frame.view.k)
      return program
    }
    if (frame.linkCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.links)
      gl.bufferData(gl.ARRAY_BUFFER, frame.links.subarray(0, frame.linkCount * LINK_SIZE), gl.DYNAMIC_DRAW)
      // Never thinner than one device pixel, or lines would flicker in and out.
      gl.uniform1f(gl.getUniformLocation(use(this.programs.line), 'u_half'), Math.max(frame.lineWidth, 1 / frame.ratio) / 2)
      gl.bindVertexArray(this.arrays.line)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, frame.linkCount)
      if (frame.arrows) {
        gl.uniform1f(gl.getUniformLocation(use(this.programs.arrow), 'u_length'), 5 + frame.lineWidth * 2)
        gl.bindVertexArray(this.arrays.arrow)
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, frame.linkCount)
      }
    }
    if (frame.nodeCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.nodes)
      gl.bufferData(gl.ARRAY_BUFFER, frame.nodes.subarray(0, frame.nodeCount * NODE_SIZE), gl.DYNAMIC_DRAW)
      use(this.programs.node)
      gl.bindVertexArray(this.arrays.node)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, frame.nodeCount)
    }
    gl.bindVertexArray(null)
  }

  destroy(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
const parsed = new Map<string, [number, number, number, number]>()

/** A CSS colour as four numbers from 0 to 1; whatever the browser understands, `color-mix()` included. */
export function rgba(css: string): [number, number, number, number] {
  let found = parsed.get(css)
  if (!found) {
    if (!probe) return [0.6, 0.6, 0.6, 1]
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = '#000'
    probe.fillStyle = css
    probe.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
    // The probe holds colours multiplied by their opacity; they are divided back.
    found = a ? [r / a, g / a, b / a, a / 255].map((v, i) => (i < 3 ? Math.min(1, v) : v)) as [number, number, number, number] : [0, 0, 0, 0]
    if (parsed.size > 500) parsed.clear()
    parsed.set(css, found)
  }
  return found
}
