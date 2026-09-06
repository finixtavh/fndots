
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
    vec2 c = (uv - vec2(0.5)) * vec2(aspect, 1.0);
    float ang = atan(c.y, c.x);
    float rad = length(c);
    float seg = 6.0;
    float slice = 6.28318 / seg;
    float a = mod(ang + u_time * 0.05, slice);
    a = abs(a - slice * 0.5);
    vec2 kp = vec2(cos(a), sin(a)) * rad;
    float pat = sin(kp.x * 18.0) * sin(kp.y * 18.0);
    float glow = smoothstep(0.9, 1.0, sin(rad * 20.0 - u_time * 0.4) * 0.5 + 0.5);

    vec3 col = max(u_surface * 0.25, vec3(0.003));
    col += u_secondary * smoothstep(0.2, 0.9, pat * 0.5 + 0.5) * 0.22 * smoothstep(1.4, 0.2, rad);
    col += u_primary * glow * 0.35 * smoothstep(1.2, 0.1, rad);
    col += u_primary * smoothstep(0.05, 0.0, rad) * 0.3;
    col *= u_brightness * u_visibility;
    gl_FragColor = vec4(col, 1.0);
}
