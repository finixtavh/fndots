
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
    vec2 g = (u_origin + gl_FragCoord.xy) / u_canvas;
    float rows = 44.0;
    float aspect = u_canvas.x / u_canvas.y;
    vec2 grid = vec2(g.x * aspect, g.y) * rows;
    vec2 cellId = floor(grid);
    vec2 f = fract(grid);
    vec2 dotUV = vec2(f.x * 2.0, f.y * 4.0);
    vec2 dotId = floor(dotUV);
    vec2 d = fract(dotUV) - vec2(0.5);

    float t = u_time * 0.10;
    float field = sin(cellId.x * 0.53 + t + sin(cellId.y * 0.41 - t * 0.63)) * 0.5
                + sin(cellId.y * 0.61 - t * 0.77 + dotId.x * 1.71 + dotId.y * 0.93) * 0.5;
    float v = 0.5 + 0.5 * field;
    float on = smoothstep(0.52, 0.64, v);
    float r = 0.19 + 0.08 * v;
    float dist = length(d);
    float dot = smoothstep(r, r - 0.06, dist);
    float glow = smoothstep(0.5, 0.0, dist);

    vec3 col = max(u_surface * 0.30, vec3(0.003));
    col += max(u_surface * 0.9, vec3(0.008)) * dot * 0.35;
    col += u_primary * dot * on * 0.9;
    col += u_primary * glow * on * 0.30;
    col += u_secondary * dot * on * 0.15;
    col *= u_brightness * u_visibility;
    gl_FragColor = vec4(col, 1.0);
}
