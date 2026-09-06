
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_origin;
uniform vec2 u_canvas;
uniform float u_time;
uniform float u_brightness;
uniform float u_visibility;
uniform vec3 u_primary;
uniform vec3 u_secondary;
uniform vec3 u_surface;
uniform vec3 u_error;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    vec2 p = vec2(uv.x * aspect, uv.y) * 3.0;
    float t = u_time * 0.05;
    float n = vnoise(p + vec2(t, -t * 0.6)) * 0.6
            + vnoise(p * 2.1 - vec2(0.0, t)) * 0.4;
    vec3 col = mix(max(u_surface * 0.25, vec3(0.003)),
                   u_secondary * 0.35 + u_primary * 0.15,
                   smoothstep(0.25, 0.85, n));
    col *= u_brightness * u_visibility;
    gl_FragColor = vec4(col, 1.0);
}
