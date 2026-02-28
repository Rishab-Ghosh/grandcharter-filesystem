import Explorer from '@/components/Explorer';

const DEFAULT_WORKSPACE_ID =
  process.env.NEXT_PUBLIC_WORKSPACE_ID ||
  'c0000000-0000-4000-8000-000000000001';

export default function Home() {
  return (
    <main>
      <Explorer workspaceId={DEFAULT_WORKSPACE_ID} />
    </main>
  );
}
