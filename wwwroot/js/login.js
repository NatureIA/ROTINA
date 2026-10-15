(() => {
  if (localStorage.getItem('routine_token')) location.replace('/index.html');

  const form = document.getElementById('loginForm');

  form.onsubmit = async e => {
    e.preventDefault();

    const err = document.getElementById('loginError');
    err.textContent = '';

    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Entrando...';

    try {
      const email = document.getElementById('email').value.trim();

      const r = await fetch('/api/auth/login', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({
          email,
          password:document.getElementById('password').value
        })
      });

      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Não foi possível entrar.');

      localStorage.setItem('routine_token', d.token);
      localStorage.setItem('routine_login', d.email || email);
      location.replace('/index.html');
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Acessar painel';
    }
  };
})();