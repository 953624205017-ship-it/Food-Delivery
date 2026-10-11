const Food = require('../models/Food');

/**
 * Recomputes order items & totals purely from the database, ignoring any
 * price/name/image the client may have sent. Throws if an item is
 * unavailable or missing so the caller can show a friendly error.
 *
 * @param {Array<{foodId: string, quantity: number}>} cartItems
 */
async function computeOrderTotals(cartItems) {
  if (!Array.isArray(cartItems) || !cartItems.length) {
    const err = new Error('Your cart is empty.');
    err.code = 'EMPTY_CART';
    throw err;
  }

  const foodIds = cartItems.map((i) => i.foodId);
  const foods = await Food.find({ _id: { $in: foodIds } });
  const foodMap = new Map(foods.map((f) => [String(f._id), f]));

  const items = [];
  let subtotal = 0;

  for (const cartItem of cartItems) {
    const food = foodMap.get(String(cartItem.foodId));
    const quantity = Number(cartItem.quantity);

    if (!food) {
      const err = new Error('One of the selected items no longer exists.');
      err.code = 'ITEM_NOT_FOUND';
      throw err;
    }
    if (!food.available) {
      const err = new Error(`"${food.name}" is sold out.`);
      err.code = 'ITEM_SOLD_OUT';
      throw err;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      const err = new Error(`Invalid quantity for "${food.name}".`);
      err.code = 'INVALID_QUANTITY';
      throw err;
    }

    const lineTotal = Math.round(food.price * quantity * 100) / 100;
    subtotal += lineTotal;

    items.push({
      food: food._id,
      name: food.name,
      image: food.image,
      unitPrice: food.price,
      quantity,
      lineTotal,
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  return { items, subtotal, totalAmount: subtotal };
}

module.exports = { computeOrderTotals };
