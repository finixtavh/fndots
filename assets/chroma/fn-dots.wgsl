// fn dots
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

fn palette(value: f32, energy: f32) -> vec3<f32> {
    let deep = vec3<f32>(0.055, 0.075, 0.067);
    let accent = vec3<f32>(0.537, 0.694, 0.620);
    let highlight = vec3<f32>(0.82, 0.91, 0.87);
    return mix(mix(deep, accent, smoothstep(0.12, 0.72, value)), highlight,
        smoothstep(0.72, 1.08, value + energy * 0.18));
}

fn pattern(uv0: vec2<f32>) -> vec3<f32> {

    let bass = smoothstep(1.03, 1.72, uniforms.amplitude);

    let weighted = smoothstep(0.10, 0.92, uniforms.speed);
    let energy = clamp(bass * 0.66 + weighted * 0.34, 0.0, 1.0);
    let response = energy * energy;
    let motion = mix(0.018, 1.45, response);
    let deformation = mix(0.012, 0.48, response);
    let t = uniforms.time * motion;

    var uv = (uv0 - vec2<f32>(0.5, 0.5)) * vec2<f32>(1.35, 1.0);
    uv.x += sin(uv.y * 4.2 + t * 1.15) * deformation;
    uv.y += cos(uv.x * 3.7 - t * 0.88) * deformation * 0.72;

    let wave_a = sin(uv.x * 5.0 + t + sin(uv.y * 3.0 - t * 0.45));
    let wave_b = cos(uv.y * 6.0 - t * 0.76 + cos(uv.x * 2.6 + t * 0.32));
    let field = 0.5 + 0.25 * wave_a + 0.25 * wave_b;
    let pulse = smoothstep(0.18, 0.96, field + response * 0.14);
    return palette(pulse, response) * mix(0.55, 1.22, response);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dimensions = vec2<u32>(u32(uniforms.resolution.x), u32(uniforms.resolution.y));
    if id.x >= dimensions.x || id.y >= dimensions.y { return; }
    let index = id.y * dimensions.x + id.x;
    let uv = vec2<f32>(f32(id.x) / uniforms.resolution.x, f32(id.y) / uniforms.resolution.y);
    output_buffer[index] = vec4<f32>(pattern(uv), 1.0);
}
