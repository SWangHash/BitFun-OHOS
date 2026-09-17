import React from 'react';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogHeader,
  DialogHeading,
  DialogTitle,
  type DialogSize,
} from '@bitfun/ui';
import './GalleryDetailModal.scss';

interface GalleryDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  icon?: React.ReactNode;
  iconGradient?: string;
  title: string;
  badges?: React.ReactNode;
  description?: string;
  meta?: React.ReactNode;
  heroActions?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
  titleTestId?: string;
  descriptionTestId?: string;
  closeButtonTestId?: string;
  titlePlacement?: 'header' | 'hero';
  size?: DialogSize;
  stableHeight?: boolean;
}

const GalleryDetailModal: React.FC<GalleryDetailModalProps> = ({
  isOpen,
  onClose,
  className,
  icon,
  iconGradient,
  title,
  badges,
  description,
  meta,
  heroActions,
  actions,
  children,
  testId,
  titleTestId,
  descriptionTestId,
  closeButtonTestId,
  titlePlacement = 'header',
  size = 'md',
  stableHeight = false,
}) => {
  const heroTitleId = React.useId();
  const usesHeroTitle = titlePlacement === 'hero';
  const appearanceState = [
    usesHeroTitle ? 'heroTitle' : '',
    stableHeight ? 'stableHeight' : '',
  ].filter(Boolean).join(' ');
  const descriptionContent = description?.trim() ? (
    <p
      className="gallery-detail-modal__description"
      data-bitfun-component="gallery-detail-modal"
      data-bitfun-part="description"
      data-testid={descriptionTestId}
    >
      {description.trim()}
    </p>
  ) : null;
  const badgesContent = badges ? (
    <div
      className="gallery-detail-modal__badges"
      data-bitfun-component="gallery-detail-modal"
      data-bitfun-part="badges"
    >
      {badges}
    </div>
  ) : null;
  const metaContent = meta ? (
    <div
      className="gallery-detail-modal__meta"
      data-bitfun-component="gallery-detail-modal"
      data-bitfun-part="meta"
    >
      {meta}
    </div>
  ) : null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
      size={size}
      aria-labelledby={usesHeroTitle ? heroTitleId : undefined}
      className={[
        stableHeight ? 'gallery-detail-modal__surface--stable-height' : '',
        className,
      ].filter(Boolean).join(' ') || undefined}
      data-testid={testId}
    >
      {!usesHeroTitle ? (
        <DialogHeader>
          <DialogHeading>
            <DialogTitle data-testid={titleTestId}>{title}</DialogTitle>
          </DialogHeading>
          <DialogClose data-testid={closeButtonTestId} />
        </DialogHeader>
      ) : null}
      <DialogBody
        className={stableHeight ? 'gallery-detail-modal__dialog-body--stable-height' : undefined}
      >
      <div
        className={[
          'gallery-detail-modal',
          usesHeroTitle ? 'gallery-detail-modal--hero-title' : '',
          stableHeight ? 'gallery-detail-modal--stable-height' : '',
        ].filter(Boolean).join(' ')}
        data-bitfun-component="gallery-detail-modal"
        data-bitfun-part="root"
        data-bitfun-state={appearanceState || undefined}
      >
        <div
          className="gallery-detail-modal__hero"
          data-bitfun-component="gallery-detail-modal"
          data-bitfun-part="hero"
        >
          <div className="gallery-detail-modal__hero-heading">
            {icon ? (
              <div
                className="gallery-detail-modal__icon"
                data-bitfun-component="gallery-detail-modal"
                data-bitfun-part="icon"
                style={iconGradient ? ({ '--gallery-detail-gradient': iconGradient } as React.CSSProperties) : undefined}
              >
                {icon}
              </div>
            ) : null}
            <div
              className="gallery-detail-modal__summary"
              data-bitfun-component="gallery-detail-modal"
              data-bitfun-part="summary"
            >
              {usesHeroTitle ? (
                <>
                  <h2
                    id={heroTitleId}
                    className="gallery-detail-modal__title"
                    data-bitfun-component="gallery-detail-modal"
                    data-bitfun-part="title"
                    data-testid={titleTestId}
                  >
                    {title}
                  </h2>
                  {descriptionContent}
                  {badgesContent || metaContent ? (
                    <div className="gallery-detail-modal__details">
                      {badgesContent}
                      {metaContent}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  {badgesContent}
                  {descriptionContent}
                  {metaContent}
                </>
              )}
            </div>
          </div>
          {heroActions ? (
            <div
              className="gallery-detail-modal__hero-actions"
              data-bitfun-component="gallery-detail-modal"
              data-bitfun-part="heroActions"
            >
              {heroActions}
            </div>
          ) : null}
          {usesHeroTitle ? (
            <DialogClose className="gallery-detail-modal__close" data-testid={closeButtonTestId} />
          ) : null}
        </div>

        {children ? (
          <div
            className="gallery-detail-modal__content"
            data-bitfun-component="gallery-detail-modal"
            data-bitfun-part="content"
          >
            {children}
          </div>
        ) : null}

        {actions ? (
          <div
            className="gallery-detail-modal__actions"
            data-bitfun-component="gallery-detail-modal"
            data-bitfun-part="actions"
          >
            {actions}
          </div>
        ) : null}
      </div>
      </DialogBody>
    </Dialog>
  );
};

export default GalleryDetailModal;
export type { GalleryDetailModalProps };
