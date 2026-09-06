
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

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    vec2 p = vec2(uv.x * aspect, uv.y);
    float t = u_time * 0.02;
    vec3 col = max(u_surface * 0.22, vec3(0.002));
    for (int layer = 0; layer < 3; layer++) {
        float fi = float(layer);
        float scale = 18.0 + fi * 22.0;
        vec2 gp = vec2(p.x * scale + t * (1.0 + fi * 0.7), p.y * scale);
        vec2 id = floor(gp);
        vec2 f = fract(gp) - vec2(0.5);
        float h = hash(id + fi * 17.0);
        vec2 off = vec2(hash(id + 3.1), hash(id + 7.7)) - vec2(0.5);
        float star = smoothstep(0.10 - fi * 0.02, 0.0, length(f - off * 0.6)) * step(0.82 - fi * 0.06, h);
        float tw = 0.6 + 0.4 * sin(u_time * (1.0 + h * 2.0) + h * 40.0);
        col += mix(vec3(0.9), u_primary, step(0.93, h)) * star * tw * (0.35 + fi * 0.25);
    }
    col *= u_brightness * u_visibility;
    gl_FragColor = vec4(col, 1.0);
}
