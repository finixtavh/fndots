// Music Bar Visibility
let _visible = true
type MusicBarController = { show: () => void; hide: () => void }
const _controllers = new Set<MusicBarController>()

export function registerMusicBarController(ctrl: MusicBarController): () => void {
  _controllers.add(ctrl)

  if (!_visible) ctrl.hide()
  return () => { _controllers.delete(ctrl) }
}

export function isMusicBarVisible(): boolean {
  return _visible
}

export function hideMusicBar() {
  if (!_visible) return
  _visible = false
  _controllers.forEach(ctrl => { try { ctrl.hide() } catch (_) {} })
}

export function showMusicBar() {
  if (_visible) return
  _visible = true
  _controllers.forEach(ctrl => { try { ctrl.show() } catch (_) {} })
}
