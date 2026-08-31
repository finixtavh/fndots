#!/usr/bin/gjs
// verify icons

imports.gi.versions.GdkPixbuf = '2.0'
const GdkPixbuf = imports.gi.GdkPixbuf
const ByteArray = imports.byteArray

try {
  const loader = GdkPixbuf.PixbufLoader.new_with_type('svg')
  loader.write(ByteArray.fromString(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><circle cx="1" cy="1" r="1"/></svg>',
  ))
  loader.close()
  if (!loader.get_pixbuf()) throw new Error('SVG loader returned no pixbuf')
} catch (error) {
  printerr(`SVG icon rendering is unavailable: ${error}`)
  imports.system.exit(1)
}
