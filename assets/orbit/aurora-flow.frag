
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
    float x = uv.x;
    float y = uv.y;
    float t = u_time * 0.08;
    float w1 = sin(x * 6.28318 * 1.1 + t) * 0.10
             + sin(x * 6.28318 * 0.43 - t * 0.6) * 0.05;
    float w2 = sin(x * 6.28318 * 0.7 - t * 0.8 + 1.7) * 0.12
             + sin(x * 6.28318 * 1.6 + t * 0.5) * 0.04;
    float d1 = abs(y - (0.62 + w1));
    float d2 = abs(y - (0.34 + w2));
    float band1 = smoothstep(0.16, 0.0, d1);
    float band2 = smoothstep(0.12, 0.0, d2);
    float rim1 = smoothstep(0.006, 0.0, d1);
    float rim2 = smoothstep(0.005, 0.0, d2);

    vec3 col = max(u_surface * 0.25, vec3(0.003));
    col += u_primary * band1 * 0.35;
    col += u_primary * rim1 * 0.8;
    col += u_secondary * band2 * 0.30;
    col += u_secondary * rim2 * 0.7;
    col += u_primary * smoothstep(0.4, 0.0, d1) * 0.08;
    col *= u_brightness * u_visibility;
    gl_FragColor = vec4(col, 1.0);
}
