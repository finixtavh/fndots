
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
    vec2 c = (uv - vec2(0.5)) * vec2(aspect, 1.0) * 2.0;
    float r = length(c);
    float rings = sin(r * 14.0 - u_time * 1.2) * 0.5 + 0.5;
    float fade = smoothstep(1.6, 0.1, r);
    float band = smoothstep(0.75, 0.95, rings) * fade;
    float soft = rings * fade;

    vec3 col = max(u_surface * 0.25, vec3(0.003));
    col += u_primary * band * 0.8;
    col += u_secondary * soft * 0.12;
    col += u_primary * smoothstep(0.08, 0.0, r) * 0.25;
    col *= u_brightness * u_visibility;
    gl_FragColor = vec4(col, 1.0);
}
