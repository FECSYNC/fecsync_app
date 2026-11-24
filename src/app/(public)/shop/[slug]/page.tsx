import ProductDetailsPage from './ProductDetailsClient';

export default async function ShopProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ProductDetailsPage slug={slug} />;
}
