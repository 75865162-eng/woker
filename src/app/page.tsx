import type { Metadata } from "next";
import { BrandHome } from "@/components/brand-site/brand-home";

export const metadata: Metadata = {
  title: "AOOCY | Thoughtful Signs for Everyday Spaces",
  description:
    "AOOCY is an independent brand dedicated to the design, development and sale of practical signage products for everyday spaces.",
};

export default function HomePage() {
  return <BrandHome />;
}
