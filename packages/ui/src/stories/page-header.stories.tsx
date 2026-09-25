import type { Meta, StoryObj } from '@storybook/react-vite';

import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';

const meta = {
  title: 'Components/PageHeader',
  component: PageHeader,
  args: {
    title: 'Bookings',
    description: 'Everything scheduled, requested and completed across your courses.',
  },
  parameters: { frame: 'paper' },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithActions: Story = {
  render: (args) => (
    <PageHeader
      {...args}
      meta="12 upcoming · 3 awaiting a reply"
      actions={
        <>
          <Button variant="secondary" size="sm" type="button">
            Export CSV
          </Button>
          <Button size="sm" type="button">
            New slot
          </Button>
        </>
      }
    />
  ),
};

export const WithBreadcrumbs: Story = {
  render: (args) => (
    <PageHeader
      {...args}
      breadcrumbs={[
        { label: 'Courses', href: '#courses' },
        { label: 'Advanced Guitar', href: '#course' },
        { label: 'Bookings' },
      ]}
    />
  ),
};

/**
 * Loading keeps the header's height so the table underneath does not jump when
 * the data lands.
 */
export const Loading: Story = {
  args: { loading: true, description: undefined, title: 'ignored while loading' },
};
