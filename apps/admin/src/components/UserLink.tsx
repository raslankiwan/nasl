import { Link } from '@tanstack/react-router';

export interface UserSummary {
  id: string;
  name: string | null;
  phone?: string | null;
}

export function UserLink({ user }: { user: UserSummary }) {
  return (
    <Link to="/users/$userId" params={{ userId: user.id }}>
      <bdi>{user.name || user.phone || user.id}</bdi>
    </Link>
  );
}
