/**
 * Hotel Little Jappan - Shopping Cart Manager
 *
 * Manages multi-item cart state client-side using localStorage.
 * Always validates prices and availability server-side during checkout.
 */

(function (window) {
  'use strict';

  const STORAGE_KEY = 'hlj_cart_v1';

  function getCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      return Array.isArray(items) ? items : [];
    } catch (_) {
      return [];
    }
  }

  function saveCart(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn('[cart] Failed to save cart to localStorage:', e);
    }
    updateBadge();
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: { items } }));
  }

  function addToCart(foodId, quantity = 1, metadata = {}) {
    if (!foodId) return;
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    const cart = getCart();
    const index = cart.findIndex((i) => String(i.foodId) === String(foodId));

    if (index > -1) {
      cart[index].quantity = Math.min(50, cart[index].quantity + qty);
      if (metadata.name) cart[index].name = metadata.name;
      if (metadata.price) cart[index].price = metadata.price;
      if (metadata.image) cart[index].image = metadata.image;
    } else {
      cart.push({
        foodId: String(foodId),
        quantity: qty,
        name: metadata.name || 'Dish',
        price: Number(metadata.price || 0),
        image: metadata.image || '/images/food-placeholder.svg',
      });
    }

    saveCart(cart);

    if (typeof window.showToast === 'function') {
      window.showToast(`Added ${qty} × ${metadata.name || 'item'} to cart!`, 'success');
    }
  }

  function updateQuantity(foodId, quantity) {
    const qty = parseInt(quantity, 10);
    let cart = getCart();
    if (qty <= 0) {
      cart = cart.filter((i) => String(i.foodId) !== String(foodId));
    } else {
      const item = cart.find((i) => String(i.foodId) === String(foodId));
      if (item) {
        item.quantity = Math.min(50, qty);
      }
    }
    saveCart(cart);
  }

  function removeFromCart(foodId) {
    const cart = getCart().filter((i) => String(i.foodId) !== String(foodId));
    saveCart(cart);
    if (typeof window.showToast === 'function') {
      window.showToast('Item removed from cart.', 'default');
    }
  }

  function clearCart() {
    saveCart([]);
  }

  function getTotalCount() {
    return getCart().reduce((sum, item) => sum + (item.quantity || 1), 0);
  }

  function updateBadge() {
    const count = getTotalCount();
    document.querySelectorAll('.cart-count-badge').forEach((badge) => {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    });
  }

  // Update badge on initial script load and DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateBadge);
  } else {
    updateBadge();
  }

  window.HLJCart = {
    getCart,
    addToCart,
    updateQuantity,
    removeFromCart,
    clearCart,
    getTotalCount,
    updateBadge,
  };
})(window);

