import { RoleTabs } from '../../components/RoleTabs';

export default function HostLayout() {
  return (
    <RoleTabs
      role="host"
      tabs={[
        { name: 'index', labelKey: 'tabSpaces', icon: 'home' },
        { name: 'bookings', labelKey: 'tabReservations', icon: 'ticket' },
        { name: 'earnings', labelKey: 'tabEarnings', icon: 'wallet' },
        { name: 'profile', labelKey: 'tabProfile', icon: 'person' },
      ]}
    />
  );
}
