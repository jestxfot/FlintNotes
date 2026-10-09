/** What the layout needs to know about a dot and about a link, as plain numbers. */
export interface LayoutInput {
  /** x, y of every dot. */
  positions: Float32Array
  /** How hard each dot pushes the others away (negative). */
  charge: Float32Array
  /** Pull towards the centre. */
  gravity: Float32Array
  /** Pull towards the ring of unlinked notes. */
  ring: Float32Array
  radius: Float32Array
  ringRadius: number
  /** Dots further apart than this do not push each other. */
  distanceMax: number
  /** For every link: index of both ends, the length it wants to have, how stiff it is. */
  links: { source: number; target: number; distance: number; strength: number }[]
  degree: Float32Array
}

const VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
void main() {
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`

// One step of the simulation for one dot. Every dot is a pixel of the state
// texture; the shader reads all the others to add up their push, then the dot's
// own links, the pull to the centre, and moves it.
const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_state;
uniform sampler2D u_info;
uniform sampler2D u_more;
uniform sampler2D u_links;
uniform int u_count;
uniform int u_width;
uniform int u_linksWidth;
uniform float u_alpha;
uniform float u_keep;
uniform float u_far;
uniform float u_ringRadius;
uniform int u_pinned;
uniform vec2 u_pin;
out vec4 state;

void main() {
  ivec2 me = ivec2(gl_FragCoord.xy);
  int index = me.y * u_width + me.x;
  if (index >= u_count) {
    state = vec4(0.0);
    return;
  }
  vec4 self = texelFetch(u_state, me, 0);
  vec4 info = texelFetch(u_info, me, 0);
  vec4 more = texelFetch(u_more, me, 0);
  vec2 p = self.xy;
  vec2 v = self.zw;

  // Every other dot pushes this one away; two that overlap are pushed apart harder.
  for (int j = 0; j < u_count; j++) {
    if (j == index) continue;
    ivec2 at = ivec2(j % u_width, j / u_width);
    vec2 d = texelFetch(u_state, at, 0).xy - p;
    float far = dot(d, d);
    if (far > u_far) continue;
    float near = max(far, 1.0);
    v += d * (texelFetch(u_info, at, 0).x * u_alpha / near);
    float room = more.y + texelFetch(u_more, at, 0).y;
    if (far < room * room) {
      float l = max(sqrt(far), 0.01);
      v -= d / l * (room - l) * 0.35;
    }
  }

  // Links pull their ends to the length they want.
  int from = int(info.z);
  int to = from + int(info.w);
  for (int k = from; k < to; k++) {
    vec4 link = texelFetch(u_links, ivec2(k % u_linksWidth, k / u_linksWidth), 0);
    int other = int(link.x);
    vec4 that = texelFetch(u_state, ivec2(other % u_width, other / u_width), 0);
    vec2 d = that.xy + that.zw - p - v;
    float l = max(length(d), 0.01);
    v += d * ((l - link.y) / l * u_alpha * link.z);
  }

  // The centre pulls linked dots; the ring pulls the unlinked ones.
  v -= p * info.y * u_alpha;
  float r = max(length(p), 0.01);
  v += p / r * (u_ringRadius - r) * more.x * u_alpha;

  v *= u_keep;
  // A dot never jumps further in one step than a few of its own sizes.
  float speed = length(v);
  if (speed > 60.0) v *= 60.0 / speed;
  p += v;
  if (index == u_pinned) {
    p = u_pin;
    v = vec2(0.0);
  }
  state = vec4(p, v);
}`

/**
 * The force layout computed on the graphics card. Each step every dot looks at
 * every other dot, which for thousands of notes is tens of millions of pairs:
 * far too many for the page's own thread at 60 frames a second, and a few
 * milliseconds for a graphics card.
 */
export class GpuLayout {
  private program: WebGLProgram
  private quad: WebGLVertexArrayObject
  private textures: WebGLTexture[] = []
  private state: [WebGLTexture, WebGLTexture] | null = null
  private targets: [WebGLFramebuffer, WebGLFramebuffer] | null = null
  private width = 1
  private height = 1
  private linksWidth = 1
  private count = 0
  private far = 1
  private ringRadius = 0
  private current = 0
  private pixels = new Float32Array(0)

  /** `null` where the graphics card cannot render into float textures. */
  static create(gl: WebGL2RenderingContext): GpuLayout | null {
    try {
      return gl.getExtension('EXT_color_buffer_float') ? new GpuLayout(gl) : null
    } catch {
      return null
    }
  }

  private constructor(private gl: WebGL2RenderingContext) {
    const program = gl.createProgram()!
    for (const [type, source] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program')
    this.program = program
    this.quad = gl.createVertexArray()!
    gl.bindVertexArray(this.quad)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
  }

  private texture(width: number, height: number, data: Float32Array): WebGLTexture {
    const { gl } = this
    const made = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, made)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.textures.push(made)
    return made
  }

  /** Loads the graph: where the dots are and what acts on them. */
  load(input: LayoutInput): void {
    const { gl } = this
    this.free()
    const count = (this.count = input.charge.length)
    this.width = Math.max(1, Math.ceil(Math.sqrt(count)))
    this.height = Math.max(1, Math.ceil(count / this.width))
    const size = this.width * this.height * 4
    this.far = input.distanceMax * input.distanceMax
    this.ringRadius = input.ringRadius

    // A dot's links, one after another, each seen from that dot's side.
    const own: { other: number; distance: number; strength: number }[][] = Array.from({ length: count }, () => [])
    for (const { source, target, distance, strength } of input.links) {
      // Of the two ends, the one with fewer links moves more, as in d3's link force.
      const total = input.degree[source] + input.degree[target] || 1
      own[source].push({ other: target, distance, strength: (strength * input.degree[target]) / total })
      own[target].push({ other: source, distance, strength: (strength * input.degree[source]) / total })
    }
    const entries = own.reduce((n, list) => n + list.length, 0)
    this.linksWidth = Math.max(1, Math.ceil(Math.sqrt(entries)))
    const linksHeight = Math.max(1, Math.ceil(entries / this.linksWidth))
    const links = new Float32Array(this.linksWidth * linksHeight * 4)
    const state = new Float32Array(size)
    const info = new Float32Array(size)
    const more = new Float32Array(size)
    let at = 0
    for (let i = 0; i < count; i++) {
      state.set([input.positions[i * 2], input.positions[i * 2 + 1], 0, 0], i * 4)
      info.set([input.charge[i], input.gravity[i], at, own[i].length], i * 4)
      more.set([input.ring[i], input.radius[i], 0, 0], i * 4)
      for (const link of own[i]) links.set([link.other, link.distance, link.strength, 0], at++ * 4)
    }
    this.state = [this.texture(this.width, this.height, state), this.texture(this.width, this.height, state)]
    this.targets = this.state.map((texture) => {
      const target = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, target)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      return target
    }) as [WebGLFramebuffer, WebGLFramebuffer]
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.current = 0
    this.pixels = new Float32Array(size)

    gl.useProgram(this.program)
    const uniform = (name: string) => gl.getUniformLocation(this.program, name)
    gl.uniform1i(uniform('u_count'), count)
    gl.uniform1i(uniform('u_width'), this.width)
    gl.uniform1i(uniform('u_linksWidth'), this.linksWidth)
    ;[this.texture(this.width, this.height, info), this.texture(this.width, this.height, more), this.texture(this.linksWidth, linksHeight, links)].forEach((texture, i) => {
      gl.activeTexture(gl.TEXTURE1 + i)
      gl.bindTexture(gl.TEXTURE_2D, texture)
    })
    gl.uniform1i(uniform('u_info'), 1)
    gl.uniform1i(uniform('u_more'), 2)
    gl.uniform1i(uniform('u_links'), 3)
    gl.activeTexture(gl.TEXTURE0)
  }

  /**
   * Moves the graph one step and writes the new places into `positions`.
   * `pinned` is the index of a dot held in place (being dragged), or -1.
   */
  step(alpha: number, keep: number, positions: Float32Array, pinned = -1, pinX = 0, pinY = 0): void {
    const { gl } = this
    if (!this.state || !this.targets) return
    const next = 1 - this.current
    gl.useProgram(this.program)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[next])
    gl.viewport(0, 0, this.width, this.height)
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.state[this.current])
    const uniform = (name: string) => gl.getUniformLocation(this.program, name)
    gl.uniform1i(uniform('u_state'), 0)
    gl.uniform1f(uniform('u_alpha'), alpha)
    gl.uniform1f(uniform('u_keep'), keep)
    gl.uniform1f(uniform('u_far'), this.far)
    gl.uniform1f(uniform('u_ringRadius'), this.ringRadius)
    gl.uniform1i(uniform('u_pinned'), pinned)
    gl.uniform2f(uniform('u_pin'), pinX, pinY)
    gl.bindVertexArray(this.quad)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, this.pixels)
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.enable(gl.BLEND)
    this.current = next
    for (let i = 0; i < this.count; i++) {
      positions[i * 2] = this.pixels[i * 4]
      positions[i * 2 + 1] = this.pixels[i * 4 + 1]
    }
  }

  private free(): void {
    const { gl } = this
    this.textures.splice(0).forEach((texture) => gl.deleteTexture(texture))
    this.targets?.forEach((target) => gl.deleteFramebuffer(target))
    this.state = this.targets = null
  }

  destroy(): void {
    this.free()
  }
}
