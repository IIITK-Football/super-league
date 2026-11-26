/* eslint-disable react/prop-types -- this codebase does not use prop-types */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { cn } from '../../utils/cn';
import './StaggeredMenu.css';

// The menu as a staggered drawer, adapted from React Bits' StaggeredMenu (gsap): coloured underlays and the panel
// slide in from the right while the sections rise into place. The open state is controlled here, so the shell's own
// menu button drives it; closed, the panel is off-screen and inert. Items are router links.
export function StaggeredMenu({
  open,
  onClose,
  items = [],
  colors = [],
  accentColor,
  label = 'Menu',
  toggleRef,
  children,
}) {
  const panelRef = useRef(null);
  const layersRef = useRef([]);
  const timelineRef = useRef(null);
  const wasOpen = useRef(false);

  // Start off-screen so nothing flashes before the first open.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const layers = [...layersRef.current, panel].filter(Boolean);
    gsap.set(layers, { xPercent: 100 });
  }, []);

  // Slide in and stagger the sections on open; slide out and reset them on close.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const layers = layersRef.current.filter(Boolean);
    const itemLabels = [...panel.querySelectorAll('.sm-panel-itemLabel')];
    const itemNumbers = [...panel.querySelectorAll('.sm-panel-itemNum')];
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const time = (seconds) => (reduce ? 0 : seconds);

    timelineRef.current?.kill();
    timelineRef.current = null;

    if (!open) {
      gsap.to([...layers, panel], {
        xPercent: 100,
        duration: time(0.3),
        ease: 'power3.in',
        overwrite: 'auto',
        onComplete: () => {
          gsap.set(itemLabels, { yPercent: 120, rotate: 8 });
          gsap.set(itemNumbers, { opacity: 0 });
        },
      });
      return undefined;
    }

    gsap.set(itemLabels, { yPercent: 120, rotate: 8 });
    gsap.set(itemNumbers, { opacity: 0 });

    const timeline = gsap.timeline();
    layers.forEach((layer, index) => {
      timeline.to(layer, { xPercent: 0, duration: time(0.5), ease: 'power4.out' }, index * time(0.07));
    });
    const panelAt = layers.length ? (layers.length - 1) * time(0.07) + time(0.08) : 0;
    timeline.to(panel, { xPercent: 0, duration: time(0.65), ease: 'power4.out' }, panelAt);
    timeline.to(itemLabels, {
      yPercent: 0,
      rotate: 0,
      duration: time(0.9),
      ease: 'power4.out',
      stagger: { each: time(0.08), from: 'start' },
    }, panelAt + time(0.1));
    timeline.to(itemNumbers, {
      opacity: 1,
      duration: time(0.5),
      stagger: { each: time(0.06), from: 'start' },
    }, panelAt + time(0.16));
    timelineRef.current = timeline;
    return undefined;
  }, [open]);

  // Escape closes. While open the page behind does not scroll.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  // A click outside the panel and its button closes the menu.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const panel = panelRef.current;
      const toggle = toggleRef?.current;
      if (panel && !panel.contains(event.target) && !(toggle && toggle.contains(event.target))) onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onClose, toggleRef]);

  // Focus the first section on open, and give focus back to the button on close.
  useEffect(() => {
    if (open) panelRef.current?.querySelector('a')?.focus();
    else if (wasOpen.current) toggleRef?.current?.focus();
    wasOpen.current = open;
  }, [open, toggleRef]);

  return (
    <div className="sm" data-open={open || undefined} style={accentColor ? { '--sm-accent': accentColor } : undefined}>
      <div className="sm-layers" aria-hidden="true">
        {colors.map((color, index) => (
          <div key={index} ref={(node) => { layersRef.current[index] = node; }} className="sm-layer" style={{ background: color }} />
        ))}
      </div>
      <aside
        id="site-menu"
        ref={panelRef}
        inert={open ? undefined : ''}
        aria-hidden={!open}
        aria-label={label}
        className="sm-panel"
      >
        <div className="sm-panel-inner">
          <nav aria-label="Sections">
            <ul className="sm-panel-list">
              {items.map((item, index) => (
                <li key={`${item.to}-${item.label}`} className="sm-panel-itemWrap">
                  <Link
                    to={item.to}
                    onClick={onClose}
                    aria-current={item.active ? 'page' : undefined}
                    className={cn('sm-panel-item', item.active && 'is-active')}
                  >
                    <span className="sm-panel-itemNum" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <span className="sm-panel-itemLabel">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {children}
        </div>
      </aside>
    </div>
  );
}
