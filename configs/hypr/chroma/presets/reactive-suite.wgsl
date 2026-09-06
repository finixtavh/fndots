// reactive test
struct Uniforms {
    time: f32,
    resolution: vec2<f32>,
    frequency: f32,
    amplitude: f32,
    speed: f32,
    color_shift: f32,
    scale: f32,
    octaves: u32,
    noise_strength: f32,
    distort_amplitude: f32,
    noise_scale: f32,
    z_rate: f32,
    brightness: f32,
    contrast: f32,
    hue: f32,
    saturation: f32,
    gamma: f32,
    vignette: f32,
    vignette_softness: f32,
    glyph_sharpness: f32,
    color_mode: u32,
    pattern_type: u32,
    effect_time: f32,
    effect_type: u32,
    beat_distortion_time: f32,
    beat_distortion_strength: f32,
    beat_zoom_strength: f32,
    background_tint: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> output_buffer: array<vec4<f32>>;

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;

const ART_PALETTE_ENABLED: bool = false;
const ART_PALETTE_COUNT: u32 = 1u;
const ART_COLOR_0: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_1: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_2: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_3: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_4: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_5: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_6: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_7: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_8: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_9: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_10: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_11: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_12: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_13: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_14: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);
const ART_COLOR_15: vec3<f32> = vec3<f32>(0.537, 0.694, 0.620);

fn rotate2(p: vec2<f32>, angle: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn hash21(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

fn noise21(p: vec2<f32>) -> f32 {
    let cell = floor(p);
    let local = fract(p);
    let blend = local * local * (vec2<f32>(3.0) - 2.0 * local);
    let a = hash21(cell);
    let b = hash21(cell + vec2<f32>(1.0, 0.0));
    let c = hash21(cell + vec2<f32>(0.0, 1.0));
    let d = hash21(cell + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

fn slow_random(clock: f32, seed: f32) -> f32 {

    let segment = floor(clock);
    let local = fract(clock);
    let blend = local * local * (3.0 - 2.0 * local);
    let current = hash21(vec2<f32>(segment, seed));
    let next = hash21(vec2<f32>(segment + 1.0, seed));
    return mix(current, next, blend);
}

fn artwork_palette(phase: f32) -> vec3<f32> {
    let colors = array<vec3<f32>, 16>(
        ART_COLOR_0, ART_COLOR_1, ART_COLOR_2, ART_COLOR_3,
        ART_COLOR_4, ART_COLOR_5, ART_COLOR_6, ART_COLOR_7,
        ART_COLOR_8, ART_COLOR_9, ART_COLOR_10, ART_COLOR_11,
        ART_COLOR_12, ART_COLOR_13, ART_COLOR_14, ART_COLOR_15,
    );
    let count = max(1u, min(16u, ART_PALETTE_COUNT));
    let position = fract(phase / TAU) * f32(count);
    let first = u32(floor(position)) % count;
    let second = (first + 1u) % count;
    let local = fract(position);
    let blend = local * local * (3.0 - 2.0 * local);
    return mix(colors[first], colors[second], blend);
}

fn audio_response() -> vec3<f32> {

    let bass = smoothstep(0.96, 1.72, uniforms.amplitude);
    let pace = smoothstep(0.12, 1.12, uniforms.speed);
    let signal = clamp(bass * 0.68 + pace * 0.32, 0.0, 1.0);
    let response = signal * signal * (3.0 - 2.0 * signal);
    let strong = response * response;
    return vec3<f32>(signal, response, strong);
}

fn design_field(p0: vec2<f32>, t: f32, warp: f32, variant: u32) -> vec2<f32> {
    var p = p0;
    var value = 0.0;
    var phase = 0.0;

    if variant == 0u {

        p.x += sin(p.y * 4.5 - t * 0.45) * warp;
        let a = sin(p.x * 6.0 + t + sin(p.y * 3.2 - t * 0.4));
        let b = cos(p.y * 7.0 - t * 0.72 + cos(p.x * 2.5 + t * 0.3));
        value = 0.5 + 0.26 * a + 0.24 * b;
        phase = a - b;
    } else if variant == 1u {

        let r = length(p);
        let a = atan2(p.y, p.x);
        value = 0.5 + 0.5 * cos(r * 19.0 - t * 1.8 + sin(a * 5.0 + t * 0.35) * (0.5 + warp));
        phase = a * 1.6 + r * 5.0;
    } else if variant == 2u {

        p.x += sin(p.y * 8.0 - t) * warp;
        p.y += cos(p.x * 7.0 + t * 0.8) * warp;
        let lattice = sin(p.x * 11.0 + t) * cos(p.y * 9.0 - t * 0.7);
        value = 0.5 + 0.5 * lattice;
        phase = p.x * 3.0 - p.y * 2.0;
    } else if variant == 3u {

        p = rotate2(p, -0.58);
        let lane = floor((p.x + 1.0) * 8.0);
        let streak = abs(fract((p.y - t * (0.65 + hash21(vec2<f32>(lane, 2.0)))) * 4.0 + hash21(vec2<f32>(lane))) - 0.5);
        value = 1.0 - smoothstep(0.05, 0.34 + warp * 0.35, streak);
        phase = lane * 0.22 + p.y;
    } else if variant == 4u {

        let dune = sin(p.y * 10.0 + sin(p.x * 4.0 + t * 0.35) * 1.7 - t * 0.55);
        value = 0.5 + 0.5 * dune;
        phase = p.x * 2.4 + dune;
    } else if variant == 5u {

        let r = length(p);
        let a = atan2(p.y, p.x);
        let petals = cos(a * 7.0 + r * 10.0 - t * 1.25);
        value = 0.5 + 0.5 * petals * cos(r * 8.0 - t * 0.55);
        phase = a * 2.0 + t * 0.12;
    } else if variant == 6u {

        let c1 = vec2<f32>(sin(t * 0.8), cos(t * 0.63)) * (0.22 + warp);
        let c2 = vec2<f32>(cos(t * 0.51 + 1.7), sin(t * 0.91)) * (0.30 + warp * 0.5);
        let c3 = vec2<f32>(sin(t * 0.37 - 1.1), cos(t * 0.74 + 2.0)) * 0.36;
        let d1 = 1.0 / max(0.035, dot(p - c1, p - c1));
        let d2 = 1.0 / max(0.035, dot(p - c2, p - c2));
        let d3 = 1.0 / max(0.035, dot(p - c3, p - c3));
        value = smoothstep(16.0, 48.0, d1 + d2 + d3);
        phase = d1 * 0.04 - d2 * 0.03;
    } else if variant == 7u {

        let r = length(p);
        let a = atan2(p.y, p.x);
        let rings = 1.0 - smoothstep(0.05, 0.24, abs(fract(r * 6.0 - t * 0.42) - 0.5));
        let sweep = 1.0 - smoothstep(0.02, 0.55, abs(atan2(sin(a - t), cos(a - t))));
        value = clamp(rings * 0.72 + sweep * 0.55, 0.0, 1.0);
        phase = a + r * 3.0;
    } else if variant == 8u {

        let drift = vec2<f32>(sin(t * 0.44), cos(t * 0.36)) * warp;
        let checker = sin((p.x + drift.x) * 12.0) * sin((p.y + drift.y) * 12.0);
        value = 0.5 + 0.5 * checker;
        phase = (p.x + p.y) * 4.0 + t * 0.2;
    } else if variant == 9u {

        let cells = p * 7.0 + vec2<f32>(t * 0.11, -t * 0.08);
        let stars = pow(clamp((noise21(cells) - 0.63) * 2.7, 0.0, 1.0), 0.55);
        let mist = noise21(p * 3.0 - vec2<f32>(t * 0.05, 0.0));
        value = clamp(stars + mist * 0.38, 0.0, 1.0);
        phase = noise21(cells + 7.0) * TAU;
    } else if variant == 10u {

        let wave = sin(p.y * 8.0 - t * 1.1) * (0.20 + warp);
        let d1 = abs(p.x - wave);
        let d2 = abs(p.x + wave);
        value = clamp((1.0 - smoothstep(0.015, 0.16, d1)) + (1.0 - smoothstep(0.015, 0.16, d2)), 0.0, 1.0);
        phase = p.y * 3.0 + t * 0.25;
    } else if variant == 11u {

        let r = max(0.035, length(p));
        let a = atan2(p.y, p.x);
        let tunnel = sin(10.0 / r - t * 2.0 + sin(a * 6.0) * (0.8 + warp));
        value = 0.5 + 0.5 * tunnel;
        phase = a * 2.5 - r;
    } else if variant == 12u {

        let n = noise21(floor((p + vec2<f32>(t * 0.08, 0.0)) * 8.0));
        let cut = abs(sin((p.x + n * warp) * 14.0) + cos((p.y - n * warp) * 13.0));
        value = 1.0 - smoothstep(0.08, 0.72, cut);
        phase = n * TAU + p.x;
    } else if variant == 13u {

        let r2 = max(0.025, dot(p, p));
        let bend = vec2<f32>(p.x * p.x - p.y * p.y, 2.0 * p.x * p.y) / r2;
        let field = sin((bend.x + bend.y) * 4.0 + t * 0.85);
        value = 0.5 + 0.5 * field;
        phase = atan2(bend.y, bend.x);
    } else if variant == 14u {

        p.y += sin(p.x * 3.5 + t * 0.36) * (0.08 + warp * 0.5);
        let tide = sin(p.y * 13.0 - t * 0.62) + 0.35 * sin(p.x * 6.0 + t * 0.27);
        value = smoothstep(-0.75, 0.75, tide);
        phase = p.x * 2.0 + p.y;
    } else if variant == 15u {

        p = rotate2(p, t * 0.34);
        let diamond = abs(fract((p.x + p.y) * 5.0) - 0.5) + abs(fract((p.x - p.y) * 5.0) - 0.5);
        value = 1.0 - smoothstep(0.20, 0.68 + warp * 0.3, diamond);
        phase = (p.x - p.y) * 4.0;
    } else if variant == 16u {

        let drift = vec2<f32>(t * 0.12, -t * 0.07);
        let n1 = noise21(p * 2.8 + drift);
        let n2 = noise21(p * 5.6 - drift * 1.4) * 0.5;
        let n3 = noise21(p * 11.2 + drift.yx) * 0.25;
        value = smoothstep(0.32, 1.16, n1 + n2 + n3 + warp * 0.25);
        phase = n1 * 3.0 - n2 * 2.0;
    } else if variant == 17u {

        let r = length(p);
        let a = atan2(p.y, p.x);
        let ring = 1.0 - smoothstep(0.025, 0.10, abs(fract(r * 4.0) - 0.5));
        let sweep = 1.0 - smoothstep(0.015, 0.75, abs(atan2(sin(a - t * 1.3), cos(a - t * 1.3))));
        value = clamp(ring * 0.42 + sweep * (1.0 - r), 0.0, 1.0);
        phase = a + t * 0.15;
    } else if variant == 18u {

        let a = atan2(p.y, p.x);
        let r = length(p);
        let folded = abs(fract(a / TAU * 8.0 + t * 0.035) * 2.0 - 1.0);
        value = 0.5 + 0.5 * sin(r * 16.0 + folded * 5.0 - t * 0.45);
        phase = folded * PI + r;
    } else {

        let drift = vec2<f32>(t * 0.15, sin(t * 0.28) * warp);
        let n1 = noise21(p * 4.0 + drift);
        let n2 = noise21(p * 9.0 - drift.yx);
        let vein = abs(n1 - n2);
        value = 1.0 - smoothstep(0.035, 0.25 + warp * 0.15, vein);
        phase = n1 * TAU + t * 0.18;
    }

    return vec2<f32>(clamp(value, 0.0, 1.0), phase);
}

fn render_design(uv0: vec2<f32>) -> vec3<f32> {
    let audio = audio_response();
    let variant = uniforms.effect_type % 20u;
    let intermediate = variant == 4u || variant == 9u || variant == 14u || variant == 18u;
    let motion_ceiling = select(1.65, 0.72, intermediate);
    let warp_ceiling = select(0.48, 0.22, intermediate);
    let motion = mix(0.018, motion_ceiling, audio.z);
    let random_clock = uniforms.time * 0.055;
    let random_seed = f32(variant) * 13.17 + uniforms.hue * 0.021 + uniforms.scale * 3.7;
    let random_a = slow_random(random_clock, random_seed);
    let random_b = slow_random(random_clock + 4.73, random_seed + 19.41);
    let random_c = slow_random(random_clock + 9.16, random_seed + 41.08);
    let variation = mix(0.12, 0.30, audio.y);
    let phase_jitter = (random_a - 0.5) * variation;
    let scale_jitter = 1.0 + (random_b - 0.5) * 0.08 * variation;
    let angle_jitter = (random_c - 0.5) * 0.16 * variation;
    let hue_jitter = (random_b - random_c) * 0.30 * variation;
    let warp = mix(0.004, warp_ceiling, audio.z) * mix(0.96, 1.04, random_c);
    let t = uniforms.time * motion + phase_jitter;

    var p = (uv0 - vec2<f32>(0.5)) * vec2<f32>(1.35, 1.0) * uniforms.scale * scale_jitter;
    p = rotate2(p, angle_jitter);
    p.x += sin(p.y * 3.1 + t * 0.43) * warp * 0.35;
    p.y += cos(p.x * 2.7 - t * 0.37) * warp * 0.28;

    let field = design_field(p, t, warp, variant);
    let shaped = pow(clamp(field.x, 0.0, 1.0), max(0.5, uniforms.glyph_sharpness));

    let hue_phase = field.y + uniforms.color_shift + uniforms.hue / 360.0 * TAU + f32(variant) * 0.31 + hue_jitter;
    let rainbow = vec3<f32>(
        0.5 + 0.5 * cos(hue_phase),
        0.5 + 0.5 * cos(hue_phase + 2.0943951),
        0.5 + 0.5 * cos(hue_phase + 4.1887902),
    );
    var chroma = rainbow;
    if ART_PALETTE_ENABLED {
        chroma = artwork_palette(hue_phase);
    }
    let luma = dot(chroma, vec3<f32>(0.299, 0.587, 0.114));
    let saturated = mix(vec3<f32>(luma), chroma, clamp(uniforms.saturation, 0.0, 1.6));
    let intensity = mix(0.16, 1.0, shaped) * mix(0.62, 1.18, audio.y);
    var color = mix(uniforms.background_tint, saturated * uniforms.brightness, intensity);

    let edge = smoothstep(0.34, 0.92, distance(uv0, vec2<f32>(0.5)));
    color = mix(color, uniforms.background_tint, edge * uniforms.vignette);
    return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dimensions = vec2<u32>(u32(uniforms.resolution.x), u32(uniforms.resolution.y));
    if id.x >= dimensions.x || id.y >= dimensions.y { return; }
    let index = id.y * dimensions.x + id.x;
    let uv = vec2<f32>(f32(id.x) / uniforms.resolution.x, f32(id.y) / uniforms.resolution.y);
    output_buffer[index] = vec4<f32>(render_design(uv), 1.0);
}
