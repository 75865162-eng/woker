import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/brand-site/privacy-policy";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How AOOCY handles information on its brand website and in connection with products sold through online storefronts.",
};

export default function PrivacyPolicyPage() {
  return <PrivacyPolicy />;
}
