import { chargeOf, GATHER_PULL, groupForces, KEEP, MAX_SPEED, REPEL_SCALE, RING_PULL, ringRadiusOf, type LayoutInput } from './physics'

export type { LayoutInput } from './physics'

const VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
void main() {
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`

// One step of the simulation for one dot, the formulas of physics.ts. Every dot
// is a pixel of the state texture; the shader reads all the others to add up
// their push (exactly, not by cells: the card has the time), then the dot's own
// links, its group, the middle or the ring, and moves it.
const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_state;
uniform sampler2D u_info;
uniform sampler2D u_more;
uniform sampler2D u_links;
uniform sampler2D u_groups;
uniform int u_count;
uniform int u_width;
uniform int u_linksWidth;
uniform float u_alpha;
uniform float u_repel;
uniform float u_attract;
uniform float u_gravity;
uniform float u_gather;
uniform float u_ringRadius;
uniform float u_ringPull;
uniform float u_keep;
uniform float u_maxSpeed;
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
  // info: charge, linked (1) or not (0), first link, number of links
  vec4 info = texelFetch(u_info, me, 0);
  // more: radius, group (-1 for none), held (1), unused
  vec4 more = texelFetch(u_more, me, 0);
  vec2 p = self.xy;
  vec2 v = self.zw;
  if (more.z > 0.5) {
    state = vec4(p, 0.0, 0.0);
    return;
  }
  vec2 f = vec2(0.0);
  vec2 apart = vec2(0.0);

  // Every other dot pushes this one away: repel * q_i * q_j / d. Dots that overlap are also moved apart.
  for (int j = 0; j < u_count; j++) {
    if (j == index) continue;
    ivec2 at = ivec2(j % u_width, j / u_width);
    vec2 d = p - texelFetch(u_state, at, 0).xy;
    float d2 = dot(d, d);
    if (d2 < 1e-6) d = vec2(float(index - j) * 0.01, 0.01);
    f += d * (u_repel * info.x * texelFetch(u_info, at, 0).x / max(d2, 1.0));
    float room = more.x + texelFetch(u_more, at, 0).x + 2.0;
    if (d2 < room * room) {
      float l = max(sqrt(d2), 0.01);
      apart += d / l * (room - l) * 0.4;
    }
  }

  // Links pull with the logarithm of their length; the share of this end is in the link.
  int from = int(info.z);
  int to = from + int(info.w);
  for (int k = from; k < to; k++) {
    vec4 link = texelFetch(u_links, ivec2(k % u_linksWidth, k / u_linksWidth), 0);
    int other = int(link.x);
    vec2 d = texelFetch(u_state, ivec2(other % u_width, other / u_width), 0).xy - p;
    float l = max(length(d), 0.01);
    f += d * (u_attract * link.z * link.y * log(1.0 + l / link.y) / l);
  }

  // The group: its centre pulls, the other groups push (worked out on the processor, per group).
  int group = int(more.y);
  if (group >= 0) {
    vec4 centre = texelFetch(u_groups, ivec2(group, 0), 0);
    vec4 push = texelFetch(u_groups, ivec2(group, 1), 0);
    if (centre.z > 0.5) f += (centre.xy - p) * u_gather + push.xy;
  }

  // The middle holds the linked dots, as hard as they push.
  if (info.y > 0.5) f -= p * u_gravity * info.x;

  v = (v + f * u_alpha) * u_keep;
  float speed = length(v);
  if (speed > u_maxSpeed) v *= u_maxSpeed / speed;
  p += v + apart;
  // The unlinked ones are drawn to their ring by place, not by force.
  if (info.y < 0.5) {
    float r = max(length(p), 0.01);
    p *= 1.0 + (u_ringRadius / r - 1.0) * u_ringPull;
  }
  if (index == u_pinned) {
    p = u_pin;
    v = vec2(0.0);
  }
  state = vec4(p, v);
}`

/**
 * The force layout computed on the graphics card. Each step every dot looks at
 * every other dot, which for thousands of notes is tens of millions of pairs:
 * a few milliseconds for a graphics card. What concerns whole groups (their
 * centres and how they push one another) is little work and is done on the
 * processor between steps, from the places the card has just returned.
 */
export class GpuLayout {
  private program: WebGLProgram
  private quad: WebGLVertexArrayObject
  private textures: WebGLTexture[] = []
  private state: [WebGLTexture, WebGLTexture] | null = null
  private targets: [WebGLFramebuffer, WebGLFramebuffer] | null = null
  private groupsTexture: WebGLTexture | null = null
  private moreTexture: WebGLTexture | null = null
  private more = new Float32Array(0)
  private width = 1
  private height = 1
  private linksWidth = 1
  private count = 0
  private current = 0
  private pixels = new Float32Array(0)
  private input: LayoutInput | null = null
  private xs = new Float32Array(0)
  private ys = new Float32Array(0)
  private charge = new Float32Array(0)
  private groups = new Float32Array(0)
  private live = new Uint8Array(0)
  private groupData = new Float32Array(0)
  /** The textures of texture units 1..4, bound again before every step: the picture is drawn with the same card. */
  private units: WebGLTexture[] = []

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
    this.input = input
    const count = (this.count = input.radius.length)
    this.width = Math.max(1, Math.ceil(Math.sqrt(count)))
    this.height = Math.max(1, Math.ceil(count / this.width))
    const size = this.width * this.height * 4
    const { degree } = input

    // A dot's links, one after another, each seen from that dot's side, with the share of the pull that end takes.
    const own: { other: number; rest: number; share: number }[][] = Array.from({ length: count }, () => [])
    for (let k = 0; k < input.links.length; k += 2) {
      const a = input.links[k]
      const b = input.links[k + 1]
      const total = degree[a] + degree[b] || 1
      const rest = input.linkLength[k >> 1]
      const strength = input.linkStrength[k >> 1]
      own[a].push({ other: b, rest, share: (strength * degree[b]) / total })
      own[b].push({ other: a, rest, share: (strength * degree[a]) / total })
    }
    const entries = own.reduce((n, list) => n + list.length, 0)
    this.linksWidth = Math.max(1, Math.ceil(Math.sqrt(entries)))
    const linksHeight = Math.max(1, Math.ceil(entries / this.linksWidth))
    const links = new Float32Array(this.linksWidth * linksHeight * 4)
    const state = new Float32Array(size)
    const info = new Float32Array(size)
    this.more = new Float32Array(size)
    this.charge = Float32Array.from(degree, chargeOf)
    let at = 0
    for (let i = 0; i < count; i++) {
      state.set([input.positions[i * 2], input.positions[i * 2 + 1], 0, 0], i * 4)
      info.set([this.charge[i], degree[i] > 0 ? 1 : 0, at, own[i].length], i * 4)
      this.more.set([input.radius[i], input.cluster[i], 0, 0], i * 4)
      for (const link of own[i]) links.set([link.other, link.rest, link.share, 0], at++ * 4)
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
    this.xs = new Float32Array(count)
    this.ys = new Float32Array(count)
    for (let i = 0; i < count; i++) [this.xs[i], this.ys[i]] = [input.positions[i * 2], input.positions[i * 2 + 1]]
    const clusters = Math.max(1, input.clusters)
    this.groups = new Float32Array(clusters * 4)
    this.live = new Uint8Array(clusters)
    this.groupData = new Float32Array(clusters * 2 * 4)

    gl.useProgram(this.program)
    const uniform = (name: string) => gl.getUniformLocation(this.program, name)
    gl.uniform1i(uniform('u_count'), count)
    gl.uniform1i(uniform('u_width'), this.width)
    gl.uniform1i(uniform('u_linksWidth'), this.linksWidth)
    this.moreTexture = this.texture(this.width, this.height, this.more)
    this.groupsTexture = this.texture(clusters, 2, this.groupData)
    this.units = [this.texture(this.width, this.height, info), this.moreTexture, this.texture(this.linksWidth, linksHeight, links), this.groupsTexture]
    this.units.forEach((texture, i) => {
      gl.activeTexture(gl.TEXTURE1 + i)
      gl.bindTexture(gl.TEXTURE_2D, texture)
    })
    gl.uniform1i(uniform('u_info'), 1)
    gl.uniform1i(uniform('u_more'), 2)
    gl.uniform1i(uniform('u_links'), 3)
    gl.uniform1i(uniform('u_groups'), 4)
    gl.activeTexture(gl.TEXTURE0)
  }

  /** Leaves a dot where it is (or lets it go again). */
  keep(index: number, on: boolean, x: number, y: number): void {
    const { gl } = this
    if (!this.state || index < 0 || index >= this.count || !this.moreTexture) return
    this.more[index * 4 + 2] = on ? 1 : 0
    gl.bindTexture(gl.TEXTURE_2D, this.moreTexture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, this.more)
    // The dot is put where it was dropped, in both state textures.
    for (const texture of this.state) {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, index % this.width, Math.floor(index / this.width), 1, 1, gl.RGBA, gl.FLOAT, new Float32Array([x, y, 0, 0]))
    }
  }

  /**
   * Moves the graph one step and writes the new places into `positions`.
   * `pinned` is the index of a dot held in place (being dragged), or -1.
   */
  step(alpha: number, positions: Float32Array, pinned = -1, pinX = 0, pinY = 0): void {
    const { gl, input } = this
    if (!this.state || !this.targets || !input) return
    const { forces } = input

    // ---- the groups, from where the dots are now
    const clusters = Math.max(1, input.clusters)
    groupForces(this.xs, this.ys, this.charge, input.cluster, input.clusters, forces.gather, this.groups, this.live)
    for (let c = 0; c < clusters; c++) {
      this.groupData.set([this.groups[c * 4], this.groups[c * 4 + 1], this.live[c], 0], c * 4)
      this.groupData.set([this.groups[c * 4 + 2], this.groups[c * 4 + 3], 0, 0], (clusters + c) * 4)
    }
    this.units.forEach((texture, i) => {
      gl.activeTexture(gl.TEXTURE1 + i)
      gl.bindTexture(gl.TEXTURE_2D, texture)
    })
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, clusters, 2, gl.RGBA, gl.FLOAT, this.groupData)

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
    gl.uniform1f(uniform('u_repel'), forces.repel * REPEL_SCALE)
    gl.uniform1f(uniform('u_attract'), forces.attract)
    gl.uniform1f(uniform('u_gravity'), forces.gravity)
    gl.uniform1f(uniform('u_gather'), forces.gather * GATHER_PULL)
    gl.uniform1f(uniform('u_ringRadius'), ringRadiusOf(this.xs, this.ys, input.degree, forces.ringRadius))
    gl.uniform1f(uniform('u_ringPull'), RING_PULL)
    gl.uniform1f(uniform('u_keep'), KEEP)
    gl.uniform1f(uniform('u_maxSpeed'), MAX_SPEED)
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
      positions[i * 2] = this.xs[i] = this.pixels[i * 4]
      positions[i * 2 + 1] = this.ys[i] = this.pixels[i * 4 + 1]
    }
  }

  private free(): void {
    const { gl } = this
    this.textures.splice(0).forEach((texture) => gl.deleteTexture(texture))
    this.targets?.forEach((target) => gl.deleteFramebuffer(target))
    this.state = this.targets = null
    this.groupsTexture = this.moreTexture = null
    this.units = []
  }

  destroy(): void {
    this.free()
  }
}
