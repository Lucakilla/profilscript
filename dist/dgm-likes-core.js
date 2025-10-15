(function () {
  if (window.DGMlikes) return;

  const CSS = `
    .hdm-like-btn{display:inline-flex;align-items:center;gap:.4rem;border:0;background:transparent;
      font:inherit;cursor:pointer;padding:.25rem .4rem;border-radius:12px;user-select:none}
    .hdm-like-btn .hdm-heart{display:inline-block;transform:translateY(1px)}
    .hdm-like-btn.liked .hdm-heart{filter: drop-shadow(0 0 0 rgba(0,0,0,.1))}
    .hdm-like-num{min-width:1.2em;text-align:right}
  `;
  function injectCss(){
    if (document.getElementById('dgm-likes-css')) return;
    const s=document.createElement('style'); s.id='dgm-likes-css'; s.textContent=CSS;
    document.head.appendChild(s);
  }

  function renderButton(mount, opts){
    injectCss();
    if (!mount) return null;
    const initial = (opts && opts.initial) || {};
    const id = opts && opts.id;

    const btn = document.createElement('button');
    btn.className = 'hdm-like-btn' + (initial.liked ? ' liked' : '');
    btn.innerHTML = `<span class="hdm-heart" aria-hidden="true">❤️</span>
                     <span class="hdm-like-num">${Math.max(0, Number(initial.likes||0))}</span>`;
    btn.addEventListener('click', async () => {
      if (!id || typeof window.rpcToggleLike !== 'function') return;
      if (btn.disabled) return;
      btn.disabled = true;
      try{
        const res = await window.rpcToggleLike(id);
        btn.classList.toggle('liked', !!res.liked_now);
        const n = btn.querySelector('.hdm-like-num');
        if (n) n.textContent = String(Math.max(0, Number(res.likes||0)));
      } finally { btn.disabled = false; }
    });

    mount.replaceChildren(btn);
    return btn;
  }

  window.DGMlikes = { renderButton };
})();
