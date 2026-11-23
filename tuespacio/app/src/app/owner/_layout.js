import { RoleTabs } from '../../components/RoleTabs';

export default function OwnerLayout() {
  return (
    <RoleTabs
      role="owner"
      tabs={[
        { name: 'index', labelKey: 'tabSummary', icon: 'grid' },
        { name: 'bookings', labelKey: 'tabReservations', icon: 'ticket' },
        { name: 'settings', labelKey: 'tabLot', icon: 'options' },
        { name: 'profile', labelKey: 'tabProfile', icon: 'person' },
      ]}
    />
  );
}
