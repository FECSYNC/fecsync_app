import { Manrope } from "next/font/google";

/**
 * FECSYNC / VenueFlow public styles — scoped mostly to `.vf-landing-page`.
 * Loaded for (public) and (user) shells; shop routes omit the vf class.
 *
 * Manrope is self-hosted via next/font (no Google Fonts round-trip).
 */
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
  fallback: ["system-ui", "sans-serif"],
  preload: true,
});

export default function VenueFlowPublicStyles() {
  return (
    <>
      <link
        rel="stylesheet"
        href="/venueflow/styles.css?v=20261029btns"
        precedence="high"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            :root{--vf-font-manrope:${manrope.style.fontFamily}}
            html.vf-landing-page,body.vf-landing-page{margin:0;width:100%;max-width:100%;overflow-x:clip;font-family:var(--vf-font-manrope),system-ui,sans-serif}
            .vf-landing-page .mega{position:absolute;left:0;right:0;top:100%;opacity:0;visibility:hidden;pointer-events:none;max-height:0;overflow:hidden}
            .vf-landing-page .nav-item.is-open>.mega{opacity:1;visibility:visible;pointer-events:auto;max-height:min(80vh,640px);overflow:auto}
            .vf-landing-page .site-header{position:sticky;top:0;z-index:50;background:#fff}
            .vf-landing-page .nav-list{display:flex;align-items:center;flex-wrap:nowrap;list-style:none;margin:0;padding:0}
            .vf-landing-page .drawer{display:none}
            .vf-landing-page .announce{width:100%;max-width:100%;box-sizing:border-box;overflow:hidden}
            .vf-landing-page .announce p{min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
            .vf-landing-page .announce a{white-space:normal}
            @media (max-width:1099px){.vf-landing-page .menu-toggle{display:inline-flex!important;width:44px;height:44px;min-width:44px;flex-direction:column;justify-content:center;align-items:center;gap:5px;position:relative;z-index:70;flex-shrink:0;background:transparent;border:0;cursor:pointer}.vf-landing-page .menu-toggle span{display:block;width:20px;height:2px;background:#0b1f2a;border-radius:2px}.vf-landing-page .nav-actions .btn-ghost{display:none!important}.vf-landing-page .primary-nav{display:none}}
            .vf-landing-page .brand{display:inline-flex;align-items:center;gap:.65rem;transform:none;scale:none;min-width:0}
            .vf-landing-page .brand-mark,.vf-landing-page .brand-mark svg{width:34px!important;height:34px!important;max-width:34px!important;max-height:34px!important;aspect-ratio:1/1!important;flex-shrink:0!important;display:block!important;overflow:hidden;transform:none!important;scale:none!important}
            .vf-landing-page .brand-name,.vf-landing-page .brand-signal,.vf-landing-page .brand-signal-main,.vf-landing-page .brand-signal-sub{font-family:var(--vf-font-manrope),system-ui,sans-serif!important;font-stretch:100%!important;transform:none!important;scale:none!important;line-height:1.1}
            .vf-landing-page .brand-name{white-space:nowrap}
            .vf-landing-page .brand-signal{display:flex;flex-direction:column;align-items:flex-start;width:100%;max-width:100%}
            .vf-landing-page .brand-signal-main{display:block;white-space:nowrap;width:auto;max-width:100%;overflow:hidden;text-overflow:ellipsis}
            .vf-landing-page .brand-signal-sub{display:block;white-space:normal;width:auto;max-width:28ch;overflow:visible;font-size:clamp(0.72rem,1.6vw,0.95rem);font-weight:600;letter-spacing:0.02em;line-height:1.25}
            @media (max-width:900px){.vf-landing-page .hero-shell{grid-template-columns:minmax(0,1fr)!important}}
          `,
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var p=location.pathname;var shop=["/shop","/cart","/checkout","/fabrics","/trending-fashion","/customize","/tailors"];var isShop=shop.some(function(s){return p===s||p.indexOf(s+"/")===0});var isHome=p==="/home"||p==="/";if(isShop)return;document.documentElement.classList.add("vf-landing-page");function a(){if(document.body)document.body.classList.add("vf-landing-page")}a();document.addEventListener("DOMContentLoaded",a);})();`,
        }}
      />
    </>
  );
}
