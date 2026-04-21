import { isUUID } from "../utils/validate.js";

export interface Product {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
  category: string;
  createdAt: Date;
}

const products = new Map<string, Product>();

export function findProduct(id: string): Product | null {
  if (!isUUID(id)) return null;
  return products.get(id) ?? null;
}

export function listProducts(category?: string): Product[] {
  const all = Array.from(products.values());
  return category ? all.filter((p) => p.category === category) : all;
}

export function createProduct(data: Omit<Product, "id" | "createdAt">): Product {
  const product: Product = { ...data, id: crypto.randomUUID(), createdAt: new Date() };
  products.set(product.id, product);
  return product;
}

export function decrementStock(productId: string, quantity: number): boolean {
  const product = findProduct(productId);
  if (!product || product.stock < quantity) return false;
  product.stock -= quantity;
  return true;
}

export function updatePrice(productId: string, priceCents: number): boolean {
  const product = findProduct(productId);
  if (!product) return false;
  product.priceCents = priceCents;
  return true;
}
