import { AgGridReact } from 'ag-grid-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AllCommunityModule,
  ColGroupDef,
  Column,
  ColumnGroup,
  ColumnHeaderClickedEvent,
  ModuleRegistry,
  type ColDef,
} from 'ag-grid-community';
import './App.scss';

ModuleRegistry.registerModules([AllCommunityModule]);

const flatAllColumnInViewport = (items: (Column | ColumnGroup)[] | null) => {
  const results: (Column | ColumnGroup)[] = [];

  const walk = (items: (Column | ColumnGroup)[] | null) => {
    if (items === null || items.length === 0) return;

    items.forEach(item => {
      // column인지 group인지 판단
      if (item.isColumn) results.push(item);
      else {
        // group인 경우 먼저 push 후 자식 탐색
        const isPadded = item.isPadding();
        // 패딩/래핑 그룹이면 자기 자신은 건너뛰고 children만 내려감
        if (isPadded) {
          const children = item.getChildren();
          if (children) walk(children as any);
          return;
        }

        // 실제 의미 있는 그룹이면 group 도 넣고 children 도 내려감
        results.push(item);
        const children = item.getChildren();
        if (children) walk(children);
      }
    });
  };

  walk(items);

  return items === null ? [] : results;
};

function App() {
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const lastClickedColRef = useRef<string | null>(null);
  const [pressShift, setPressShift] = useState<boolean>(false);

  const headerItemsRef = useRef<(ColDef | ColGroupDef)[]>([]);

  const onColumnHeaderClicked = (params: ColumnHeaderClickedEvent) => {
    const colId = 'getColId' in params.column ? params.column?.getColId() : params.column?.getGroupId();

    // 현재 표시 중인 컬럼들 순서
    const checkGroups = flatAllColumnInViewport(params.api.getAllDisplayedColumnGroups());
    const getIndex = (id: string) =>
      checkGroups.findIndex(col => (col.isColumn ? col.getColId() === id : col.getGroupId() === id));

    setSelectedCols(prev => {
      // Shift: 구간 선택
      if (pressShift && lastClickedColRef.current) {
        const startIdx = getIndex(lastClickedColRef.current);
        const endIdx = getIndex(colId);
        if (startIdx === -1 || endIdx === -1) return prev;

        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const rangeIds = checkGroups.slice(from, to + 1).map(c => (c.isColumn ? c.getColId() : c.getGroupId()));

        // 기존 선택 유지 + range 추가 (중복 제거)
        const set = new Set([...prev, ...rangeIds]);
        return Array.from(set);
      }

      // 그냥 클릭: 해당 컬럼만 선택
      return [colId];
    });

    lastClickedColRef.current = colId;
  };

  useEffect(() => {
    const pressShiftHandler = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setPressShift(true);
      }
    };

    const keyupHandler = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setPressShift(false);
      }
    };

    window.addEventListener('keydown', pressShiftHandler);
    window.addEventListener('keyup', keyupHandler);

    return () => {
      window.removeEventListener('keydown', pressShiftHandler);
      window.removeEventListener('keyup', keyupHandler);
    };
  }, []);

  const headerClass: ColDef['headerClass'] = params => {
    const isGroup = params.columnGroup;

    return isGroup
      ? selectedCols.includes(params.columnGroup?.getGroupId() ?? '')
        ? 'excel-header-selected'
        : ''
      : selectedCols.includes(params.column?.getColId() ?? '')
        ? 'excel-header-selected'
        : '';
  };

  return (
    <div style={{ height: 500 }}>
      <AgGridReact
        columnDefs={[
          {
            // [그룹] A1
            headerName: 'A1',
            colId: 'A1', // 그룹 자체의 ID
            groupId: 'A1',
            marryChildren: true,
            headerClass,
            children: [
              {
                // A1-1
                headerName: 'A1-1',
                field: 'a1',
                colId: 'A1_1',
                headerClass,
              },
              {
                // A1-2
                headerName: 'A1-2',
                field: 'a2',
                colId: 'A1_2',
                headerClass,
              },
              {
                // [하위 그룹] A1-3
                headerName: 'A1-3',
                field: 'a3', // 원래 a3 쓰시던 것 유지
                colId: 'A1_3',
                groupId: 'A1_3',
                marryChildren: true,
                headerClass,
                children: [
                  {
                    // A1-3-1
                    headerName: 'A1-3-1',
                    field: 'a13',
                    colId: 'A1_3_1',
                    headerClass,
                  },
                  {
                    // A1-3-2
                    headerName: 'A1-3-2',
                    field: 'a14',
                    colId: 'A1_3_2',
                    headerClass,
                  },
                ],
              },
            ],
          },

          {
            // [단일 컬럼] A2
            headerName: 'A2',
            field: 'a4',
            colId: 'A2',
            headerClass,
          },

          {
            // [단일 컬럼] A3
            headerName: 'A3',
            field: 'a5',
            colId: 'A3',
            headerClass,
          },

          {
            // [그룹] A4
            headerName: 'A4',
            colId: 'A4',
            groupId: 'A4',
            marryChildren: true,
            headerClass,
            children: [
              {
                headerName: 'A4-1',
                field: 'a7',
                colId: 'A4_1',
                headerClass,
              },
              {
                headerName: 'A4-2',
                field: 'a8',
                colId: 'A4_2',
                headerClass,
              },
              {
                headerName: 'A4-3',
                field: 'a9',
                colId: 'A4_3',
                headerClass,
              },
              {
                headerName: 'A4-4',
                field: 'a10',
                colId: 'A4_4',
                headerClass,
              },
              {
                headerName: 'A4-5',
                field: 'a11',
                colId: 'A4_5',
                headerClass,
              },
              {
                headerName: 'A4-6',
                field: 'a12',
                colId: 'A4_6',
                headerClass,
                pinned: 'left',
              },
            ],
          },
        ]}
        onColumnHeaderClicked={onColumnHeaderClicked}
        loading={false}
      />
    </div>
  );
}

export default App;
