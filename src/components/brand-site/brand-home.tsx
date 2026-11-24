"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  Check,
  Globe2,
  HeartHandshake,
  PenTool,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import "./brand-home.css";


type Product = { name: string; desc: string; image: string; asin: string };
type Pillar = { title: string; desc: string; icon: LucideIcon };

/**
 * Categories mirror our real, synced Amazon catalogue (signage products).
 * Both the `asin` and the product photo come from live Amazon catalog data —
 * images are the MAIN variant pulled through the Seller Catalog Items API.
 * No catalogue data or imagery from any other marketplace is used.
 */
const products: Product[] = [
  { name: "Private Property Signs", desc: "Posted private property & no-trespassing notices — rust-free aluminium, pre-drilled for outdoor use.", image: "/products/private-property.jpg", asin: "B098P831WG" },
  { name: "No Soliciting Signs", desc: "Polite but firm messages that keep unwanted visitors and solicitors away.", image: "/products/door.jpg", asin: "B08NB54ZTG" },
  { name: "No Smoking Signs", desc: "Vintage-style no-smoking tin signs for yards, garages and shared spaces.", image: "/products/no-smoking.jpg", asin: "B0BQHCXWLP" },
  { name: "Pool Rules Signs", desc: "Weather-resistant pool safety & depth signs with pre-drilled mounting holes.", image: "/products/pool.jpg", asin: "B0D4TTSTMY" },
  { name: "Parking Signs", desc: "No-parking and reserved-space notices in rust-free aluminium with pre-drilled holes.", image: "/products/parking.jpg", asin: "B09BNXX141" },
  { name: "Trash & Garbage Signs", desc: "Simple, durable sorting and disposal guides for cleaner environments.", image: "/products/delivery.jpg", asin: "B09YLXMX45" },
  { name: "Exit Only Signs", desc: "Clear directional signage that guides people safely and efficiently.", image: "/products/exit.jpg", asin: "B0D4TLH9F7" },
  { name: "Delivery Signs", desc: "Package-delivery instruction signs for back doors, porches and entrances.", image: "/products/delivery.jpg", asin: "B09YLW7JZY" },
  { name: "Beware of Dogs Signs", desc: "Fence and window warning signs that help visitors feel at ease.", image: "/products/dog.jpg", asin: "B08ZHPND3M" },
  { name: "Door Signs", desc: "Welcoming and informative plaques for every entrance and door.", image: "/products/door.jpg", asin: "B09HPNMLP3" },
  { name: "Functional & Custom Signs", desc: "A growing range of practical signs, thoughtfully made for everyday needs.", image: "/products/no-dumping.jpg", asin: "B09YM52S7K" },
];

const pillars: Pillar[] = [
  { title: "Independent Brand Development", desc: "Building our own brands with a clear identity and long-term vision.", icon: Globe2 },
  { title: "Product Design & Development", desc: "Designing practical products that solve real everyday problems.", icon: PenTool },
  { title: "Quality Control", desc: "Careful attention to materials, finish and every detail we ship.", icon: ShieldCheck },
  { title: "Customer-Focused Solutions", desc: "Listening to customers and refining products around their experience.", icon: HeartHandshake },
  { title: "International Market Experience", desc: "Serving customers across borders with dependable service.", icon: Search },
];

function HeroArt() {
  // 真实产品图：来自我们已同步上架的庭院标牌目录（铝制 Private Property / Pool Rules 标牌）。
  return (
    <div className="bp-hero-art" role="img" aria-label="Our real yard signs: Private Property and Pool Rules aluminium signs">
      <div className="bp-hero-stage">
        <div className="bp-hero-card bp-hero-card-main">
          <Image src="/products/private-property.jpg" alt="Private Property / No Trespassing yard sign" width={560} height={560} priority style={{ objectFit: "contain" }} />
        </div>
        <div className="bp-hero-card bp-hero-card-sub">
          <Image src="/products/pool.jpg" alt="Pool Rules safety sign" width={300} height={300} style={{ objectFit: "contain" }} />
        </div>
      </div>
    </div>
  );
}

export function BrandHome() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Progressive enhancement: only arm the reveal animation once JS is running.
    root.classList.add("bp-animate");
    const nodes = root.querySelectorAll(".bp-reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("bp-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="bp" ref={rootRef}>
      {/* Navbar */}
      <nav className="bp-nav">
        <div className="bp-wrap bp-nav-in">
          <Link href="/" className="bp-logo" aria-label="Home">
            <Image src="/brand-logo.png" alt="Brand logo" width={38} height={38} priority />
            <b>AOOCY</b>
          </Link>
          <div className="bp-links" id="bp-links">
            <a href="#home">Home</a>
            <a href="#about">About Us</a>
            <a href="#products">Our Products</a>
            <a href="#contact">Contact Us</a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <button className="bp-burger" aria-label="Menu" onClick={() => document.getElementById("bp-links")?.classList.toggle("bp-open")}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="bp-hero" id="home">
        <div className="bp-wrap bp-hero-grid">
          <div className="bp-reveal">
            <span className="bp-eyebrow">Durable Yard &amp; Property Signs</span>
            <h1>Make your space <em>clearer</em>,<br />safer and more welcoming.</h1>
            <p className="bp-slogan">Rust-free aluminium. Pre-drilled to mount in minutes. Built for the outdoors.</p>
            <p className="bp-lead">
              From &ldquo;Private Property&rdquo; and pool rules to parking, no-smoking and delivery notes — our
              yard signs say clearly what matters, so homes, pools and driveways feel safer and more considered.
            </p>
            <div className="bp-actions">
              <a href="#products" className="bp-btn bp-btn-primary">Explore Our Products <Check size={16} /></a>
              <a href="#about" className="bp-btn bp-btn-ghost">About Us</a>
            </div>
            <div className="bp-trust">
              <div><b>Own Brand</b><span>Independent &amp; growing</span></div>
              <div><b>Product Focus</b><span>Design to delivery</span></div>
              <div><b>Global Reach</b><span>Serving overseas markets</span></div>
            </div>
          </div>
          <div className="bp-reveal">
            <HeroArt />
          </div>
        </div>
      </section>

      {/* About */}
      <section className="bp-about" id="about">
        <div className="bp-wrap bp-about-grid">
          <div className="bp-reveal">
            <span className="bp-eyebrow">About Us</span>
            <h2 className="bp-title">A company built around<br />its own brands and products.</h2>
            <p>
              We are a product-driven business with our own Amazon brands. From the first sketch to the
              finished item, we take part in every stage of design, development, production and sales.
            </p>
            <p>
              Our focus is on making useful, well-considered products for overseas markets — signs that
              are clear, durable and genuinely helpful in daily life. We care about quality, practicality
              and the experience each customer has with what we make.
            </p>
            <p>
              Rather than claiming scale, we let the details speak: reliable materials, thoughtful design
              and a steady commitment to getting the small things right.
            </p>
          </div>
          <div className="bp-pillars bp-reveal">
            {pillars.slice(0, 4).map((p) => (
              <div className="bp-pillar" key={p.title}>
                <div className="bp-ic"><p.icon size={20} strokeWidth={1.8} /></div>
                <h4>{p.title}</h4>
                <p>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Our Brand */}
      <section className="bp-brand-band" id="brand">
        <div className="bp-wrap bp-brand-grid">
          <div className="bp-reveal">
            <div className="bp-brand-mark">
              <Image src="/brand-logo.png" alt="Our brand" width={104} height={104} />
              <b>AOOCY</b>
              <span>Our Own Brand</span>
            </div>
          </div>
          <div className="bp-reveal">
            <span className="bp-eyebrow">Our Brand</span>
            <h2 className="bp-title">An independent brand,<br />with a point of view.</h2>
            <p className="bp-lead">
              AOOCY is our own brand — a home for products we design and develop around real needs.
              We believe a good product should be simple to use, built to last and quietly improve the
              space it belongs to.
            </p>
            <p className="bp-brand-quote">“Considered design for the everyday spaces we share.”</p>
            <div className="bp-brand-tags">
              <span>Independent Brand</span>
              <span>Product Planning</span>
              <span>Quality First</span>
              <span>Customer Experience</span>
            </div>
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="bp-products" id="products">
        <div className="bp-wrap">
          <div className="bp-center bp-reveal">
            <span className="bp-eyebrow">Our Products</span>
            <h2 className="bp-title">Functional signs,<br />made with care.</h2>
            <p className="bp-lead">A growing range of practical signage for homes, pools, driveways and shared spaces.</p>
          </div>
          <div className="bp-grid">
            {products.map((product) => (
              <article className="bp-card bp-reveal" key={product.name}>
                <div className="bp-thumb">
                  <Image src={product.image} alt={product.name} fill sizes="(max-width: 700px) 90vw, (max-width: 1100px) 45vw, 30vw" style={{ objectFit: "contain" }} />
                </div>
                <div className="bp-card-body">
                  <h3>{product.name}</h3>
                  <p>{product.desc}</p>
                  <span className="bp-asin">Ref. {product.asin}</span>
                </div>
              </article>
            ))}
          </div>
          <p className="bp-note">Product photos are drawn from our live catalogue.</p>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="bp-why">
        <div className="bp-wrap">
          <div className="bp-center bp-reveal">
            <span className="bp-eyebrow">Why Choose Us</span>
            <h2 className="bp-title">What shapes the way we work.</h2>
          </div>
          <div className="bp-why-grid">
            {pillars.map((p) => (
              <div className="bp-why-item bp-reveal" key={p.title}>
                <div className="bp-ic"><p.icon size={24} strokeWidth={1.7} /></div>
                <h4>{p.title}</h4>
                <p>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="bp-contact" id="contact">
        <div className="bp-wrap bp-contact-grid">
          <div className="bp-reveal">
            <span className="bp-eyebrow">Contact Us</span>
            <h2 className="bp-title">Here to help,<br />wherever you shop.</h2>
            <p className="bp-lead">
              Our products are available through our online storefronts. For questions about a product or an
              order, please reach out through the store where you purchased it — our team is happy to help there.
            </p>
          </div>
          <div className="bp-contact-card bp-reveal">
            <div className="bp-crow">
              <div className="bp-ic"><Globe2 size={18} /></div>
              <div><b>Product &amp; order support</b><span className="bp-tbd">Via your storefront</span></div>
            </div>
            <div className="bp-crow">
              <div className="bp-ic"><HeartHandshake size={18} /></div>
              <div><b>Partnership enquiries</b><span className="bp-tbd">Via your storefront</span></div>
            </div>
            <div className="bp-crow">
              <div className="bp-ic"><ShieldCheck size={18} /></div>
              <div><b>Privacy</b><Link href="/privacy-policy" className="bp-inline-link">Privacy Policy</Link></div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bp-foot">
        <div className="bp-wrap">
          <div className="bp-foot-grid">
            <div>
              <div className="bp-logo">
                <Image src="/brand-logo.png" alt="Brand logo" width={34} height={34} />
                <b>AOOCY</b>
              </div>
              <p>Thoughtful signs for everyday spaces. An independent brand dedicated to practical, well-made products.</p>
            </div>
            <div>
              <h5>Explore</h5>
              <ul>
                <li><a href="#home">Home</a></li>
                <li><a href="#about">About Us</a></li>
                <li><a href="#brand">Our Brand</a></li>
                <li><a href="#products">Our Products</a></li>
                <li><a href="#contact">Contact Us</a></li>
              </ul>
            </div>
            <div>
              <h5>Information</h5>
              <ul>
                <li><Link href="/privacy-policy">Privacy Policy</Link></li>
                <li><a href="#contact">Contact Us</a></li>
              </ul>
            </div>
          </div>
          <div className="bp-foot-bottom">
            <span>© 2026 AOOCY. All rights reserved.</span>
            <Link href="/HKQ" className="bp-foot-staff">Internal Staff Login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
