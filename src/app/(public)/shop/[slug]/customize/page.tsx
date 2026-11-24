import ProductCustomizePage from './ProductCustomizeClient';

export default async function ShopProductCustomizePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ProductCustomizePage slug={slug} />;
}
