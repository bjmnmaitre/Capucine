/**
 * Shopping Assistant - Main App Logic
 */

const API_BASE = 'http://localhost:5000/api';
let currentUser = null;
let currentListId = null;

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

async function initializeApp() {
  // Vérifier si l'utilisateur est connecté
  const token = localStorage.getItem('auth_token');

  if (token) {
    // Vérifier la validité du token
    const isValid = await verifyToken(token);
    if (isValid) {
      showAppPage();
      loadUserProfile();
    } else {
      localStorage.removeItem('auth_token');
      showAuthPage();
    }
  } else {
    showAuthPage();
  }

  // Event listeners
  setupNavigation();
  setupAuthListeners();
}

/**
 * Vérifier la validité du token
 */
async function verifyToken(token) {
  try {
    const response = await fetch(`${API_BASE}/auth/verify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    return response.ok;
  } catch (error) {
    console.error('Erreur de vérification du token:', error);
    return false;
  }
}

/**
 * Afficher la page d'authentification
 */
function showAuthPage() {
  document.getElementById('authPage').style.display = 'block';
  document.getElementById('appPage').style.display = 'none';
}

/**
 * Afficher la page de l'app
 */
function showAppPage() {
  document.getElementById('authPage').style.display = 'none';
  document.getElementById('appPage').style.display = 'block';
  loadLists();
}

/**
 * Navigation
 */
function setupNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();

      // Désactiver tous les liens
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      // Masquer tous les contenus
      document.querySelectorAll('.page-content').forEach(content => {
        content.classList.remove('active');
      });

      // Afficher le contenu demandé
      const page = link.dataset.page;
      document.getElementById(`${page}Page`).classList.add('active');

      if (page === 'lists') {
        loadLists();
      } else if (page === 'history') {
        loadHistory();
      } else if (page === 'profile') {
        loadProfile();
      }
    });
  });

  // Bouton déconnexion
  document.getElementById('logoutBtn').addEventListener('click', logout);
}

/**
 * Déconnexion
 */
function logout() {
  localStorage.removeItem('auth_token');
  currentUser = null;
  showAuthPage();
  document.querySelector('.nav-link').classList.add('active');
}

/**
 * Charger le profil de l'utilisateur
 */
async function loadUserProfile() {
  // Pour maintenant, charger les info depuis le localStorage ou l'API
  // Ce sera implémenté avec une route GET /api/auth/me
}

/**
 * Charger les listes
 */
async function loadLists() {
  try {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/shopping/lists`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('Erreur de chargement');

    const data = await response.json();
    displayLists(data.lists);
  } catch (error) {
    showNotification('Erreur lors du chargement des listes', 'error');
    console.error(error);
  }
}

/**
 * Afficher les listes
 */
function displayLists(lists) {
  const listsList = document.getElementById('listsList');
  listsList.innerHTML = '';

  if (lists.length === 0) {
    listsList.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem;">
        <p style="color: var(--gray); margin-bottom: 1rem;">Aucune liste créée</p>
        <button class="btn-primary" id="createFirstListBtn">Créer votre première liste</button>
      </div>
    `;

    document.getElementById('createFirstListBtn').addEventListener('click', openNewListDialog);
    return;
  }

  lists.forEach(list => {
    const card = document.createElement('div');
    card.className = 'list-card';
    card.innerHTML = `
      <h3>${escapeHtml(list.title)}</h3>
      <p style="color: var(--gray); font-size: 0.95rem; margin: 0.5rem 0;">${escapeHtml(list.description || 'Pas de description')}</p>
      <div class="list-card-meta">
        <span>${list.is_completed ? '✓ Complétée' : '📋 En cours'}</span>
        <span>${list.total_cost}€</span>
        <span>${new Date(list.created_at).toLocaleDateString('fr-FR')}</span>
      </div>
    `;

    card.addEventListener('click', () => openList(list.id));
    listsList.appendChild(card);
  });
}

/**
 * Ouvrir une liste
 */
async function openList(listId) {
  currentListId = listId;

  try {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/shopping/lists/${listId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('Erreur de chargement');

    const data = await response.json();

    // Afficher la page de détails
    document.getElementById('listsPage').classList.remove('active');
    document.getElementById('listDetailsPage').classList.add('active');

    // Mettre à jour le titre
    document.getElementById('listTitle').textContent = data.list.title;
    document.getElementById('itemCount').textContent = `${data.itemCount} articles`;
    document.getElementById('checkedCount').textContent = `${data.checkedCount} coché(s)`;
    document.getElementById('totalCost').textContent = `Total: ${data.list.total_cost}€`;

    // Afficher les articles
    displayItems(data.items);

    // Setup des événements pour cette liste
    setupListDetailListeners();
  } catch (error) {
    showNotification('Erreur lors du chargement de la liste', 'error');
    console.error(error);
  }
}

/**
 * Afficher les articles
 */
function displayItems(items) {
  const itemsList = document.getElementById('itemsList');
  itemsList.innerHTML = '';

  if (items.length === 0) {
    itemsList.innerHTML = '<p style="color: var(--gray); text-align: center; padding: 2rem;">Aucun article pour l\'instant</p>';
    return;
  }

  items.forEach(item => {
    const itemElement = document.createElement('div');
    itemElement.className = `item ${item.is_checked ? 'checked' : ''}`;
    itemElement.dataset.itemId = item.id;

    itemElement.innerHTML = `
      <input type="checkbox" ${item.is_checked ? 'checked' : ''} class="item-checkbox">
      <div class="item-details">
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-meta">${item.quantity} ${item.unit}${item.category ? ` • ${item.category}` : ''}${item.estimated_price ? ` • ${item.estimated_price}€` : ''}</div>
      </div>
      <div class="item-actions">
        <button class="edit-item" data-item-id="${item.id}">Modifier</button>
        <button class="delete-item danger" data-item-id="${item.id}">Supprimer</button>
      </div>
    `;

    itemElement.querySelector('.item-checkbox').addEventListener('change', async (e) => {
      await updateItem(item.id, { isChecked: e.target.checked });
      itemElement.classList.toggle('checked');
    });

    itemsList.appendChild(itemElement);
  });
}

/**
 * Setup des événements pour la page de détails
 */
function setupListDetailListeners() {
  // Retour
  document.getElementById('backListBtn').addEventListener('click', () => {
    currentListId = null;
    document.getElementById('listDetailsPage').classList.remove('active');
    document.getElementById('listsPage').classList.add('active');
    loadLists();
  });

  // Ajouter un article
  document.getElementById('addItemBtn').addEventListener('click', addItem);
  document.getElementById('itemInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addItem();
  });

  // Recommandations
  document.getElementById('recommendationsBtn').addEventListener('click', async () => {
    await loadRecommendations();
  });

  document.getElementById('closeRecommendationsBtn').addEventListener('click', () => {
    document.getElementById('recommendationsModal').style.display = 'none';
  });

  // Compléter la liste
  document.getElementById('completeListBtn').addEventListener('click', async () => {
    await updateList(currentListId, { isCompleted: true });
    showNotification('Liste marquée comme complétée');
    loadLists();
  });

  // Supprimer la liste
  document.getElementById('deleteListBtn').addEventListener('click', async () => {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette liste ?')) {
      await deleteList(currentListId);
      showNotification('Liste supprimée');
      currentListId = null;
      document.getElementById('listDetailsPage').classList.remove('active');
      document.getElementById('listsPage').classList.add('active');
      loadLists();
    }
  });
}

/**
 * Ajouter un article
 */
async function addItem() {
  const input = document.getElementById('itemInput');
  const itemName = input.value.trim();

  if (!itemName) {
    showNotification('Veuillez entrer un nom d\'article', 'warning');
    return;
  }

  try {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/shopping/items`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        listId: currentListId,
        name: itemName
      })
    });

    if (!response.ok) throw new Error('Erreur');

    input.value = '';
    showNotification('Article ajouté');
    openList(currentListId);
  } catch (error) {
    showNotification('Erreur lors de l\'ajout de l\'article', 'error');
    console.error(error);
  }
}

/**
 * Mettre à jour un article
 */
async function updateItem(itemId, updates) {
  try {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/shopping/items/${itemId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) throw new Error('Erreur');

    return await response.json();
  } catch (error) {
    showNotification('Erreur lors de la mise à jour', 'error');
    console.error(error);
  }
}

/**
 * Supprimer un article
 */
async function deleteItem(itemId) {
  try {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/shopping/items/${itemId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('Erreur');

    showNotification('Article supprimé');
    openList(currentListId);
  } catch (error) {
    showNotification('Erreur lors de la suppression', 'error');
    console.error(error);
  }
}

/**
 * Mettre à jour une liste
 */
async function updateList(listId, updates) {
  try {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/shopping/lists/${listId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) throw new Error('Erreur');

    return await response.json();
  } catch (error) {
    showNotification('Erreur lors de la mise à jour', 'error');
    console.error(error);
  }
}

/**
 * Supprimer une liste
 */
async function deleteList(listId) {
  try {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/shopping/lists/${listId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('Erreur');

    return await response.json();
  } catch (error) {
    showNotification('Erreur lors de la suppression', 'error');
    console.error(error);
  }
}

/**
 * Charger l'historique
 */
async function loadHistory() {
  // À implémenter
  console.log('Charger l\'historique');
}

/**
 * Charger le profil
 */
async function loadProfile() {
  // À implémenter
  console.log('Charger le profil');
}

/**
 * Charger les recommandations
 */
async function loadRecommendations() {
  try {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/recommendations/get`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        listId: currentListId
      })
    });

    if (!response.ok) throw new Error('Erreur');

    const data = await response.json();

    // Afficher le modal
    const modal = document.getElementById('recommendationsModal');
    const content = document.getElementById('recommendationsContent');

    content.innerHTML = '';

    if (data.recommendations.length === 0) {
      content.innerHTML = '<p style="text-align: center; color: var(--gray);">Aucune recommandation disponible</p>';
    } else {
      data.recommendations.forEach(rec => {
        const div = document.createElement('div');
        div.className = 'recommendation-item';
        div.innerHTML = `
          <span class="recommendation-type">${rec.type || 'conseil'}</span>
          <h4>${escapeHtml(rec.item || 'Recommandation')}</h4>
          <p>${escapeHtml(rec.suggestion || '')}</p>
          ${rec.savings ? `<p style="color: var(--success); font-weight: 600;">💰 ${rec.savings}</p>` : ''}
        `;
        content.appendChild(div);
      });
    }

    if (data.summary) {
      const summary = document.createElement('div');
      summary.style.cssText = 'margin-top: 1rem; padding: 1rem; background: var(--primary-light); border-radius: var(--radius);';
      summary.innerHTML = `<h4 style="color: var(--primary); margin-bottom: 0.5rem;">📝 Résumé</h4><p>${escapeHtml(data.summary)}</p>`;
      content.appendChild(summary);
    }

    modal.style.display = 'flex';
  } catch (error) {
    showNotification('Erreur lors du chargement des recommandations', 'error');
    console.error(error);
  }
}

/**
 * Ouvrir le dialog de nouvelle liste
 */
function openNewListDialog() {
  const title = prompt('Nom de la nouvelle liste:');
  if (title) {
    createNewList(title);
  }
}

/**
 * Créer une nouvelle liste
 */
async function createNewList(title) {
  try {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/shopping/lists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title })
    });

    if (!response.ok) throw new Error('Erreur');

    showNotification('Liste créée');
    loadLists();
  } catch (error) {
    showNotification('Erreur lors de la création', 'error');
    console.error(error);
  }
}

/**
 * Afficher une notification
 */
function showNotification(message, type = 'info') {
  const notification = document.getElementById('notification');
  notification.textContent = message;
  notification.className = `notification show ${type}`;

  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

/**
 * Échapper le HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event listeners des boutons de page d'accueil
document.addEventListener('DOMContentLoaded', () => {
  const newListBtn = document.getElementById('newListBtn');
  if (newListBtn) {
    newListBtn.addEventListener('click', openNewListDialog);
  }
});
