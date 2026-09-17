import React from 'react';
import { NurseryView } from './views';
import './ProfileScene.scss';

const ProfileScene: React.FC = () => (
  <div className="bitfun-profile-scene" data-bitfun-scene="profile" data-bitfun-part="root">
    <NurseryView />
  </div>
);

export default ProfileScene;
