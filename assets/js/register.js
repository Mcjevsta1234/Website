document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('registration-form');
  const status = document.getElementById('form-status');

  if (!form || !status) {
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  if (!submitButton) {
    return;
  }

  function setStatus(type, message) {
    status.textContent = message;
    status.classList.remove('form-status--success', 'form-status--error');
    if (type) {
      status.classList.add(type === 'success' ? 'form-status--success' : 'form-status--error');
      status.removeAttribute('hidden');
    } else {
      status.setAttribute('hidden', 'true');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(null, '');

    const formData = new FormData(form);
    const username = formData.get('username').trim();
    const email = formData.get('email').trim();
    const password = formData.get('password').trim();
    const confirmPassword = formData.get('confirmPassword').trim();

    if (password !== confirmPassword) {
      setStatus('error', 'Passwords do not match.');
      return;
    }

    submitButton.disabled = true;
    const originalText = submitButton.textContent;
    submitButton.textContent = 'Creating your account…';

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password }),
      });

      let result = {};
      try {
        result = await response.json();
      } catch (jsonError) {
        console.error('Failed to parse response JSON', jsonError);
      }
      if (!response.ok) {
        throw new Error(result.error || 'We could not complete your registration.');
      }

      form.reset();
      setStatus('success', result.message);
    } catch (error) {
      console.error(error);
      setStatus('error', error.message || 'Something went wrong. Please try again.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });
});
