import React, { useState } from 'react';
import './Avatar.scss';

export interface AvatarProps {
  /** Avatar size */
  size?: 'small' | 'medium' | 'large' | number;
  /** Avatar shape */
  shape?: 'circle' | 'square';
  /** Image URL */
  src?: string;
  /** Alt text when image fails to load */
  alt?: string;
  /** Icon */
  icon?: React.ReactNode;
  /** Text content */
  children?: React.ReactNode;
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: React.CSSProperties;
  /** Image load error callback */
  onError?: () => void;
}

export interface AvatarGroupProps {
  /** Max display count */
  maxCount?: number;
  /** Children */
  children: React.ReactNode;
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: React.CSSProperties;
}

export const Avatar: React.FC<AvatarProps> = ({
  size = 'medium',
  shape = 'circle',
  src,
  alt,
  icon,
  children,
  className = '',
  style,
  onError,
}) => {
  const [imgError, setImgError] = useState(false);

  const handleImgError = () => {
    setImgError(true);
    onError?.();
  };

  const getSize = () => {
    if (typeof size === 'number') return `${size}px`;
    const sizes = { small: '32px', medium: '40px', large: '48px' };
    return sizes[size];
  };

  const sizeValue = getSize();

  const avatarClass = [
    'openbitfun-avatar',
    `openbitfun-avatar--${shape}`,
    typeof size === 'string' && `openbitfun-avatar--${size}`,
    className
  ].filter(Boolean).join(' ');

  const avatarStyle: React.CSSProperties = {
    width: sizeValue,
    height: sizeValue,
    ...style,
  };

  const renderContent = () => {
    if (src && !imgError) {
      return <img src={src} alt={alt} onError={handleImgError} data-openbitfun-component="avatar" data-openbitfun-part="image" />;
    }
    if (icon) {
      return <span className="openbitfun-avatar__icon" data-openbitfun-component="avatar" data-openbitfun-part="icon">{icon}</span>;
    }
    if (children) {
      return <span className="openbitfun-avatar__text" data-openbitfun-component="avatar" data-openbitfun-part="text">{children}</span>;
    }
    return null;
  };

  return (
    <span className={avatarClass} style={avatarStyle} data-openbitfun-component="avatar" data-openbitfun-part="root" data-openbitfun-size={typeof size === 'string' ? size : 'custom'} data-openbitfun-shape={shape}>
      {renderContent()}
    </span>
  );
};

Avatar.displayName = 'Avatar';

export const AvatarGroup: React.FC<AvatarGroupProps> = ({
  maxCount = 5,
  children,
  className = '',
  style,
}) => {
  const childrenArray = React.Children.toArray(children);
  const displayChildren = maxCount ? childrenArray.slice(0, maxCount) : childrenArray;
  const restCount = childrenArray.length - maxCount;

  return (
    <div className={`openbitfun-avatar-group ${className}`} style={style} data-openbitfun-component="avatar" data-openbitfun-part="group">
      {displayChildren}
      {restCount > 0 && (
        <Avatar className="openbitfun-avatar-group__rest"><span data-openbitfun-component="avatar" data-openbitfun-part="overflow">+{restCount}</span></Avatar>
      )}
    </div>
  );
};

AvatarGroup.displayName = 'AvatarGroup';
