// Notification Center Mockup - Interactive Demo

document.addEventListener('DOMContentLoaded', () => {
  // DND Toggle
  const dndToggle = document.getElementById('dndToggle');
  let dndEnabled = false;

  dndToggle.addEventListener('click', () => {
    dndEnabled = !dndEnabled;
    dndToggle.classList.toggle('active', dndEnabled);
    console.log(`DND: ${dndEnabled ? 'ON' : 'OFF'}`);
  });

  // Night Light Toggle
  const nightToggle = document.getElementById('nightToggle');
  const nightState = document.getElementById('nightState');
  let nightEnabled = false;

  nightToggle.addEventListener('click', () => {
    nightEnabled = !nightEnabled;
    nightState.textContent = nightEnabled ? 'On · 4000 K' : 'Off';
    console.log(`Night Light: ${nightEnabled ? 'ON' : 'OFF'}`);
  });

  // Clear All Button
  const clearAllBtn = document.getElementById('clearAllBtn');
  const notifList = document.getElementById('notifList');

  clearAllBtn.addEventListener('click', () => {
    notifList.innerHTML = `
      <div class="notif-empty">No notifications</div>
    `;
    console.log('All notifications cleared');
  });

  // Dismiss Individual Notifications
  notifList.addEventListener('click', (e) => {
    const dismissBtn = e.target.closest('.notif-dismiss');
    if (dismissBtn) {
      const notifItem = dismissBtn.closest('.notif-item');
      if (notifItem) {
        notifItem.style.opacity = '0';
        notifItem.style.transform = 'translateX(20px)';
        notifItem.style.transition = 'all 200ms ease';
        
        setTimeout(() => {
          notifItem.remove();
          
          // Check if list is empty
          if (notifList.querySelectorAll('.notif-item').length === 0) {
            notifList.innerHTML = `
              <div class="notif-empty">No notifications</div>
            `;
          }
        }, 200);
        
        console.log(`Notification dismissed: ${notifItem.dataset.id}`);
      }
    }
  });

  // Action Buttons
  const actionBtns = document.querySelectorAll('.action-btn');
  
  actionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      
      // Visual feedback
      btn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        btn.style.transform = 'scale(1)';
      }, 100);
      
      // Log action
      switch (action) {
        case 'restart':
          console.log('Action: Restart Bar');
          alert('Restart Bar clicked!\n\nIn AGS, this would run:\nags quit -i ags-bar; sleep 0.3; nohup launch-ags.sh');
          break;
        case 'dashboard':
          console.log('Action: Dashboard');
          alert('Dashboard clicked!\n\nIn AGS, this would run:\nags toggle -i ags-bar dashboard');
          break;
        case 'power':
          console.log('Action: Power');
          alert('Power clicked!\n\nIn AGS, this would run:\nags toggle -i ags-bar power-menu');
          break;
        case 'settings':
          console.log('Action: Settings');
          alert('Settings clicked!\n\nIn AGS, this would run:\nags toggle -i ags-bar cava-settings');
          break;
      }
    });
  });

  // Panel Toggle
  const panel = document.querySelector('.notif-panel');
  let panelOpen = true;

  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    panel.classList.add('closing');
  }

  function openPanel() {
    if (panelOpen) return;
    panelOpen = true;
    panel.classList.remove('closing');
  }

  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }

  // Keyboard shortcut (Escape to close, N to toggle, M to toggle MusicBar)
  let musicBarVisible = false;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePanel();
      console.log('Escape pressed - panel closing');
    }
    if (e.key === 'n' || e.key === 'N') {
      togglePanel();
      console.log(`Panel ${panelOpen ? 'opened' : 'closed'}`);
    }
    if (e.key === 'm' || e.key === 'M') {
      musicBarVisible = !musicBarVisible;
      panel.classList.toggle('music-bar-visible', musicBarVisible);
      console.log(`MusicBar ${musicBarVisible ? 'visible' : 'hidden'}`);
    }
  });

  console.log('Notification Center Mockup loaded');
  console.log('Features:');
  console.log('- DND toggle');
  console.log('- Night Light toggle');
  console.log('- Clear all notifications');
  console.log('- Dismiss individual notifications');
  console.log('- Action buttons with alerts');
  console.log('- Escape key animation');
});
