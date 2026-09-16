interface BrandMarkProps {
  size?: 'medium' | 'hero';
  working?: boolean;
}

/** The canonical fine-line vector is painted with the active surface's text color. */
export function BrandMark({ size = 'medium', working = false }: BrandMarkProps) {
  return <span aria-hidden="true" className="brand-mark" data-size={size} data-working={working} />;
}
