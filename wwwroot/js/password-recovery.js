(() => {
  'use strict';

  const status = document.getElementById('recoveryStatus');
  const forgotForm = document.getElementById('forgotPasswordForm');
  const resetForm = document.getElementById('resetPasswordForm');

  function show(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  async function post(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message ||
      (response.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Não foi possível concluir. Tente novamente.'));
    return data;
  }

  if (forgotForm) {
    forgotForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = forgotForm.querySelector('button[type="submit"]');
      button.disabled = true;
      show('');
      try {
        const data = await post('/api/auth/password/forgot', {
          email: document.getElementById('recoveryEmail').value.trim()
        });
        show(data.message || 'Se o e-mail estiver cadastrado, enviaremos um link de recuperação.');
        forgotForm.reset();
      } catch (error) {
        show(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  if (resetForm) {
    // Usamos o fragmento da URL: o token não é enviado na requisição da página.
    const fragment = new URLSearchParams(location.hash.slice(1));
    const token = fragment.get('token');
    history.replaceState(null, '', location.pathname);

    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      show('Link inválido. Solicite um novo link na página de recuperação.', true);
      resetForm.querySelector('button[type="submit"]').disabled = true;
    } else {
      resetForm.addEventListener('submit', async event => {
        event.preventDefault();
        const password = document.getElementById('newPassword').value;
        const confirmation = document.getElementById('confirmPassword').value;
        if (password !== confirmation) {
          show('As senhas não coincidem.', true);
          return;
        }
        const button = resetForm.querySelector('button[type="submit"]');
        button.disabled = true;
        show('');
        try {
          const data = await post('/api/auth/password/reset', { token, newPassword: password });
          show(data.message || 'Senha redefinida com sucesso.');
          resetForm.reset();
          // Não reutilizar o formulário após a alteração.
        } catch (error) {
          show(error.message, true);
          button.disabled = false;
        }
      });
    }
  }
})();
