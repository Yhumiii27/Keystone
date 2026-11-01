// R-196 (Crucible K-3, K-196): "Project category" card of the Contract screen — client project or R&D project, chosen in the New
// project wizard, published to the group's apps in pub_projets (Crucible filters the R&D projects); the editor for the director
// and the project's leads.
import { Card, CardTitle } from '@/components/ds/Card';
import { PROJECT_CATEGORIES, PROJECT_CATEGORY_LABEL, type ProjectCategory } from '@/domain/project-category';
import type { T } from '@/i18n/translate';
import { CategoryForm } from './category-form';
import s from './contract.module.css';

export function ProjectCategoryCard({ category, code, canEdit, t }: { category: ProjectCategory; code: string; canEdit: boolean; t: T }) {
  return (
    <Card className={s.listCard}>
      <div className={s.headTop}>
        <div className={s.titleCol}>
          <CardTitle>{t('Project category')}</CardTitle>
          <span className={s.subtitle}>{t('Client project or R&D project · shared with the group’s applications')}</span>
        </div>
      </div>
      {canEdit ? (
        <CategoryForm
          code={code}
          category={category}
          labels={{
            title: t('Project category'), saved: t('Project category saved'),
            options: PROJECT_CATEGORIES.map((c) => ({ value: c, label: t(PROJECT_CATEGORY_LABEL[c]) })),
          }}
        />
      ) : (
        <div className={s.rateLine}>
          <span>{t('Project category')}</span>
          <span className={s.num}>{t(PROJECT_CATEGORY_LABEL[category])}</span>
          <span className={s.meta} />
        </div>
      )}
    </Card>
  );
}
