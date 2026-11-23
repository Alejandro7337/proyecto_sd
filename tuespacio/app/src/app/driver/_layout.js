import { RoleTabs } from '../../components/RoleTabs';

export default function DriverLayout() {
  return (
    <RoleTabs
      role="driver"
      tabs={[
        { name: 'index', labelKey: 'tabExplore', icon: 'home' },
        { name: 'reservations', labelKey: 'tabReservations', icon: 'ticket' },
        { name: 'profile', labelKey: 'tabProfile', icon: 'person' },
      ]}
    />
  );
}
