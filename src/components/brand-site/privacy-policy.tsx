"use client";

import Image from "next/image";
import Link from "next/link";

import "./brand-home.css";
import "./legal.css";

/**
 * Public-facing privacy policy for AOOCY, a brand that sells products through
 * online marketplaces. This page intentionally does not publish contact details;
 * data requests are handled through the storefront where a purchase was made.
 */
const sections = [
  {
    title: "Introduction",
    paragraphs: [
      "AOOCY (\"we\", \"us\", \"our\") is an independent brand focused on the design, development and sale of practical products for everyday spaces. We sell our products through third-party online marketplaces (the \"Storefronts\"). This Privacy Policy explains how information is handled when you visit this website or purchase our products through a Storefront.",
      "This website is informational. We do not operate a customer account system here, and we do not ask you to submit personal information through this site.",
    ],
  },
  {
    title: "Information We Collect",
    paragraphs: [
      "Website visits: Like most websites, this site may receive basic technical information automatically from your browser (such as browser type, language and approximate region). Such information is generally non-identifying and is used only to deliver and secure the site.",
      "Purchases: When you buy an AOOCY product, the Storefront — not this website — collects and processes your order, payment and delivery details. We receive only the information the Storefront makes available to sellers, such as order status, product sold and shipping confirmation, and we use it to fulfil and support your order.",
    ],
  },
  {
    title: "How We Use Information",
    paragraphs: [
      "We use limited seller-side information to fulfil orders, respond to product or order questions through the Storefront, improve our products and comply with applicable obligations. We do not sell personal information, and we do not use website visit information for advertising targeting.",
    ],
  },
  {
    title: "Sharing and Service Providers",
    paragraphs: [
      "Order handling, payments and delivery are carried out by the Storefront and its service providers under their own privacy terms. We do not receive full payment details such as complete card numbers. We may share limited information with logistics or service partners only as needed to complete an order or meet a legal requirement.",
    ],
  },
  {
    title: "Data Retention and Security",
    paragraphs: [
      "We keep seller-side order information only for as long as needed to fulfil orders, handle inquiries and meet legal or marketplace requirements. We use reasonable administrative and technical safeguards to protect information within our control. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    title: "Cookies and Analytics",
    paragraphs: [
      "This informational website does not set advertising cookies. A Storefront you visit to purchase our products may use cookies under its own privacy policy; please refer to that Storefront for details.",
    ],
  },
  {
    title: "Your Choices and Rights",
    paragraphs: [
      "Depending on where you live, you may have rights regarding access to, correction of, or deletion of your personal information. Because purchases and related data are handled by the Storefront, please submit such requests through the Storefront where you made the purchase. We will assist the Storefront where our seller-side records are involved.",
    ],
  },
  {
    title: "Children's Privacy",
    paragraphs: [
      "Our products are not directed to children, and we do not knowingly collect personal information from children through this website.",
    ],
  },
  {
    title: "Changes to This Policy",
    paragraphs: [
      "We may update this Privacy Policy from time to time to reflect changes in our practices or legal requirements. The updated version will be posted on this page with a revised effective date.",
    ],
  },
];

export function PrivacyPolicy() {
  return (
    <div className="bp">
      <nav className="bp-nav">
        <div className="bp-wrap bp-nav-in">
          <Link href="/" className="bp-logo" aria-label="Home">
            <Image src="/brand-logo.png" alt="AOOCY brand logo" width={38} height={38} priority />
            <b>AOOCY</b>
          </Link>
          <div className="bp-links" id="bp-links">
            <Link href="/#home">Home</Link>
            <Link href="/#about">About Us</Link>
            <Link href="/#products">Our Products</Link>
            <Link href="/#contact">Contact Us</Link>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <button className="bp-burger" aria-label="Menu" onClick={() => document.getElementById("bp-links")?.classList.toggle("bp-open")}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>
      </nav>

      <main className="bp-legal">
        <div className="bp-wrap">
          <Link href="/" className="bp-inline-link bp-legal-back">&larr; Back to home</Link>
          <span className="bp-eyebrow">Legal</span>
          <h1 className="bp-title">Privacy Policy</h1>
          <p className="bp-legal-meta">Effective date: 24 November 2026</p>
          <p className="bp-lead">
            This policy describes how information is handled in connection with the AOOCY brand website and the
            products sold through our Storefronts.
          </p>

          <div className="bp-legal-body">
            {sections.map((section, index) => (
              <section key={section.title} className="bp-legal-section">
                <h2>{index + 1}. {section.title}</h2>
                {section.paragraphs.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </section>
            ))}
          </div>

          <p className="bp-legal-note">
            For any privacy question relating to a purchase, please use the contact options provided by the
            Storefront where the order was placed. We do not publish direct contact details on this website.
          </p>
        </div>
      </main>

      <footer className="bp-foot">
        <div className="bp-wrap">
          <div className="bp-foot-bottom">
            <span>&copy; 2026 AOOCY. All rights reserved. <Link href="/privacy-policy" className="bp-inline-link">Privacy Policy</Link></span>
            <Link href="/tiaotiao" className="bp-foot-staff">Internal Staff Login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
