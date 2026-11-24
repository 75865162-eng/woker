import type { Metadata } from "next";
import { BrandHome } from "@/components/brand-site/brand-home";

export const metadata: Metadata = {
  title: "AOOCY | Durable Yard & Property Signs",
  description:
    "AOOCY designs and makes rust-free aluminium yard signs — private property, pool rules, parking and more — for safer, clearer, more welcoming spaces.",
};

export default function HomePage() {
  return <BrandHome />;
}
