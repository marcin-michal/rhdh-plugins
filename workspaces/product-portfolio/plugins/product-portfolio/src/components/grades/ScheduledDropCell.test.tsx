/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImageOccurrence } from '../../model/portfolioChi';
import { ScheduledDropCell } from './ScheduledDropCell';

type ScheduledDrop = ImageOccurrence['image']['futureDrops'][number];

const scheduledDrops: readonly ScheduledDrop[] = [
  { from: 'B', to: 'D', at: '2027-04-01T00:00:00.000Z' },
  { from: 'A', to: 'B', at: '2027-02-01T00:00:00.000Z' },
  { from: 'D', to: 'F', at: '2027-03-01T00:00:00.000Z' },
] as const;

function renderCell(drops: readonly ScheduledDrop[]) {
  return render(<ScheduledDropCell drops={drops} />);
}

describe('ScheduledDropCell', () => {
  it('shows a placeholder when the image has no scheduled drops', () => {
    const { container } = renderCell([]);

    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the next drop and opens an ordered list of all drops', async () => {
    const user = userEvent.setup();
    renderCell(scheduledDrops);

    const trigger = screen.getByRole('button', {
      name: /Next scheduled drop.*to grade B.*Show all 3 scheduled drops/,
    });
    expect(trigger).toHaveTextContent(/A\s*→\s*B/);
    expect(trigger).not.toHaveTextContent('Grade');
    expect(
      Array.from(
        trigger.querySelectorAll('strong'),
        grade => grade.textContent,
      ),
    ).toEqual(['A', 'B']);
    expect(
      Array.from(trigger.querySelectorAll('strong'), grade =>
        grade.getAttribute('data-weight'),
      ),
    ).toEqual(['bold', 'bold']);
    expect(trigger.querySelector('svg')).toHaveAttribute(
      'viewBox',
      '0 0 16 16',
    );
    expect(trigger.querySelector('svg')).toHaveStyle({ display: 'block' });
    expect(trigger).toHaveStyle({ verticalAlign: 'middle' });
    const nextDropTime = trigger.querySelector('time');
    expect(nextDropTime).toHaveTextContent(/\d/);
    expect(nextDropTime).toHaveAttribute('datetime', scheduledDrops[1].at);
    expect(
      within(trigger).getByRole('group', {
        name: /grade A drops to grade B/,
      }),
    ).toHaveStyle({
      backgroundColor: 'var(--bui-bg-warning)',
      color: 'var(--bui-fg-warning-on-bg)',
    });

    await user.click(trigger);

    const popover = await screen.findByRole('dialog');
    const popoverStyle = popover.getAttribute('style') ?? '';
    expect(popoverStyle).toContain('background-color: var(--bui-bg-app)');
    expect(popoverStyle).toContain('border: 1px solid var(--bui-fg-secondary)');
    expect(popoverStyle).toContain(
      'box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45)',
    );
    const dropBadges = within(popover).getAllByRole('group');
    expect(
      dropBadges.map(badge => badge.querySelector('time')?.dateTime),
    ).toEqual([
      scheduledDrops[1].at,
      scheduledDrops[2].at,
      scheduledDrops[0].at,
    ]);
    expect(dropBadges[0]).toHaveTextContent(/A\s*→\s*B/);
    expect(dropBadges[1]).toHaveTextContent(/D\s*→\s*F/);
    expect(dropBadges[2]).toHaveTextContent(/B\s*→\s*D/);
    expect(dropBadges[2]).toHaveStyle({
      backgroundColor: 'var(--bui-bg-danger)',
      color: 'var(--bui-fg-danger-on-bg)',
    });
  });
});
