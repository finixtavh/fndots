
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
    vec2 p = vec2(uv.x * aspect, uv.y) * 3.0;
    float t = u_time * 0.25;
    float v = sin(p.x + t) + sin(p.y * 1.3 - t * 1.1)
            + sin((p.x + p.y) * 0.7 + t * 0.6) + sin(length(p - vec2(2.4, 1.2)) * 1.8 - t);
    v = v * 0.125 + 0.5;
    float band = smoothstep(0.15, 0.85, v);
    float line = smoothstep(0.06, 0.0, abs(v - 0.5) - 0.18);

    vec3 col = max(u_surface * 0.25, vec3(0.003));
    col = mix(col, u_secondary * 0.45, band);
    col = mix(col, u_primary * 0.75, smoothstep(0.55, 0.95, v));
    col += u_primary * line * 0.5;
    col *= u_brightness * u_visibility;
    gl_FragColor = vec4(col, 1.0);
}
