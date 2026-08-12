/**
 * Shopping Assistant - Authentication
 */

function setupAuthListeners() {
  // Toggle entre login et register
  document.getElementById('toggleRegister').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('loginForm').classList.remove('active');
    document.getElementById('registerForm').classList.add('active');
  });

  document.getElementById('toggleLogin').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('registerForm').classList.remove('active');
    document.getElementById('loginForm').classList.add('active');
  });

  // Formulaires
  document.getElementById('loginFormElement').addEventListener('submit', handleLogin);
  document.getElementById('registerFormElement').addEventListener('submit', handleRegister);
}

/**
 * Gérer la connexion
 */
async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      showNotification(data.error || 'Erreur de connexion', 'error');
      return;
    }

    // Sauvegarder le token
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    currentUser = data.user;

    showNotification('Connexion réussie');
    showAppPage();
    loadLists();

    // Reset du formulaire
    document.getElementById('loginFormElement').reset();
  } catch (error) {
    showNotification('Erreur de connexion', 'error');
    console.error(error);
  }
}

/**
 * Gérer l'inscription
 */
async function handleRegister(e) {
  e.preventDefault();

  const email = document.getElementById('registerEmail').value;
  const username = document.getElementById('registerUsername').value;
  const fullName = document.getElementById('registerFullName').value;
  const password = document.getElementById('registerPassword').value;

  if (password.length < 6) {
    showNotification('Le mot de passe doit contenir au moins 6 caractères', 'warning');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, username, fullName, password })
    });

    const data = await response.json();

    if (!response.ok) {
      showNotification(data.error || 'Erreur d\'inscription', 'error');
      return;
    }

    // Sauvegarder le token
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    currentUser = data.user;

    showNotification('Inscription réussie');
    showAppPage();
    loadLists();

    // Reset du formulaire
    document.getElementById('registerFormElement').reset();
  } catch (error) {
    showNotification('Erreur d\'inscription', 'error');
    console.error(error);
  }
}
