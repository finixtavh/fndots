
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
    float cols = 48.0;
    float cx = floor(uv.x * cols);
    float h = hash(vec2(cx, 7.0));
    float speed = 0.05 + h * 0.12;
    float y = fract(uv.y + u_time * speed + h);
    float band = smoothstep(0.0, 0.25, y) * smoothstep(1.0, 0.55, y);
    vec3 tint = mix(u_primary, u_secondary, step(0.5, hash(vec2(cx, 3.0))));

    vec3 col = max(u_surface * 0.25, vec3(0.003));
    col += tint * band * (0.10 + h * 0.20);
    col += u_primary * smoothstep(0.03, 0.0, abs(y - 0.85)) * 0.25;
    col *= u_brightness * u_visibility;
    gl_FragColor = vec4(col, 1.0);
}
