
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

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    vec2 p = vec2(uv.x * aspect, uv.y);
    float cells = 14.0;
    vec2 gp = fract(p * cells) - vec2(0.5);
    float lx = smoothstep(0.035, 0.0, abs(gp.x));
    float ly = smoothstep(0.035, 0.0, abs(gp.y));
    float grid = max(lx, ly);
    vec2 c = vec2(p.x - aspect * 0.5, p.y - 0.5);
    float r = length(c) * 2.0;
    float wave = fract(r * 0.9 - u_time * 0.18);
    float ring = smoothstep(0.10, 0.0, abs(wave - 0.5)) * smoothstep(1.5, 0.3, r);

    vec3 col = max(u_surface * 0.25, vec3(0.003));
    col += u_secondary * grid * 0.18;
    col += u_primary * grid * ring * 0.9;
    col += u_primary * ring * smoothstep(0.5, 0.0, r) * 0.10;
    col *= u_brightness * u_visibility;
    gl_FragColor = vec4(col, 1.0);
}
