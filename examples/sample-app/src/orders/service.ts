import { findActive } from "../users/repository.js";
import { findProduct, decrementStock } from "../products/repository.js";
import { authenticate } from "../auth/middleware.js";

export interface OrderItem {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  totalCents: number;
  status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
  createdAt: Date;
}

const orders = new Map<string, Order>();

export function placeOrder(authHeader: string, items: { productId: string; quantity: number }[]): Order {
  const { userId } = authenticate(authHeader);
  const user = findActive(userId);
  if (!user) throw new Error("User not found");

  const orderItems: OrderItem[] = [];
  for (const { productId, quantity } of items) {
    const product = findProduct(productId);
    if (!product) throw new Error(`Product not found: ${productId}`);
    if (!decrementStock(productId, quantity)) throw new Error(`Insufficient stock for: ${product.name}`);
    orderItems.push({ productId, quantity, unitPriceCents: product.priceCents });
  }

  const order: Order = {
    id: crypto.randomUUID(),
    userId,
    items: orderItems,
    totalCents: orderItems.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0),
    status: "pending",
    createdAt: new Date(),
  };
  orders.set(order.id, order);
  return order;
}

export function getOrder(authHeader: string, orderId: string): Order {
  const { userId } = authenticate(authHeader);
  const order = orders.get(orderId);
  if (!order) throw new Error("Order not found");
  if (order.userId !== userId) throw new Error("Access denied");
  return order;
}

export function cancelOrder(authHeader: string, orderId: string): void {
  const order = getOrder(authHeader, orderId);
  if (order.status !== "pending") throw new Error("Only pending orders can be cancelled");
  order.status = "cancelled";
}
