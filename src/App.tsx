
import { useEffect, useState } from 'react'
import './App.css'
type Hostel = {
  hostel_id: number
  hostel_name: string
  address: string
  warden_name: string
  contact_number: string
}

type Room = {
  room_id: number
  room_number: string
  room_type: string
  capacity: number
  monthly_fee: number
  hostel_id: number
}


type Allocation = {
  allocation_id: number
  student_id: number
  room_id: number
  status: string
}

type AllocationResult = {
  student_id: number
  roll_number: string
  full_name: string
  email: string
  phone: string
  allocation_id: number | null
  allocation_date: string | null
  vacate_date: string | null
  status: string | null
  room_id: number | null
  room_number: string | null
  room_type: string | null
  capacity: number | null
  monthly_fee: number | null
  hostel_name: string | null
}

type Visitor = {
  visitor_id: number
  student_name: string
  visitor_name: string
  visitor_phone: string | null
  visit_date: string
  purpose: string
  check_in_time: string | null
  check_out_time: string | null
}

type MaintenanceRequest = {
  request_id: number
  room_id: number
  student_id: number
  student_name: string
  issue_title: string
  issue_description: string
  priority: string
  request_status: string
  reported_at: string
}


const API_URL = 'http://localhost:5001'

function App() {
  const [activePage, setActivePage] = useState('Dashboard')

  const menuItems = [
    'Dashboard',
    'Hostels',
    'Rooms',
    'Room Allocations',
    'Students',
    'Maintenance',
    'Visitors',
    'Reports',
  ]

  const [hostels, setHostels] = useState<Hostel[]>([])
  const [showForm, setShowForm] = useState(false)
  const [hostelName, setHostelName] = useState('')
  const [address, setAddress] = useState('')
  const [warden, setWarden] = useState('')
  const [contact, setContact] = useState('')

  function addHostel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const newHostel: Hostel = {
      hostel_id: Date.now(),
      hostel_name: hostelName,
      address,
      warden_name: warden,
      contact_number: contact,
    }

    setHostels((previous) => [...previous, newHostel])
    setHostelName('')
    setAddress('')
    setWarden('')
    setContact('')
    setShowForm(false)
  }

const [rooms, setRooms] = useState<Room[]>([])
const [allocations, setAllocations] = useState<Allocation[]>([])
const [loading, setLoading] = useState(true)
const [apiError, setApiError] = useState('')

const [studentSearch, setStudentSearch] = useState('')
const [allocationResults, setAllocationResults] =
  useState<AllocationResult[]>([])
const [allocationLoading, setAllocationLoading] = useState(false)
const [allocationError, setAllocationError] = useState('')
const [searched, setSearched] = useState(false)

const [visitors, setVisitors] = useState<Visitor[]>([])
const [maintenanceRequests, setMaintenanceRequests] = useState<MaintenanceRequest[]>([])
const [moduleLoading, setModuleLoading] = useState(false)
const [moduleError, setModuleError] = useState('')


async function updateVisitorAttendance(
  visitorId: number,
  action: 'check-in' | 'check-out'
) {
  setModuleError('')

  try {
    const response = await fetch(
      `${API_URL}/api/visitors/${visitorId}/${action}`,
      { method: 'PATCH' }
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.detail || 'Failed to update visitor attendance.')
    }

    const refreshResponse = await fetch(`${API_URL}/api/visitors/`)

    if (!refreshResponse.ok) {
      throw new Error('Attendance updated, but refreshing visitors failed.')
    }

    const refreshedVisitors: Visitor[] = await refreshResponse.json()
    setVisitors(refreshedVisitors)
  } catch (error) {
    setModuleError(
      error instanceof Error ? error.message : 'Unable to update attendance.'
    )

    // Refresh the table even if the action fails, so displayed data
    // stays in sync with the database.
    try {
      const refreshResponse = await fetch(`${API_URL}/api/visitors/`)
      if (refreshResponse.ok) {
        const refreshedVisitors: Visitor[] = await refreshResponse.json()
        setVisitors(refreshedVisitors)
      }
    } catch {
      // Keep the original error message.
    }
  }
}

async function updateMaintenanceStatus(
  requestId: number,
  status: string
) {
  setModuleError('')

  try {
    const response = await fetch(
      `${API_URL}/api/maintenance/${requestId}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.detail || 'Failed to update maintenance status.')
    }

    const refreshResponse = await fetch(`${API_URL}/api/maintenance/`)

    if (!refreshResponse.ok) {
      throw new Error('Status updated, but refreshing requests failed.')
    }

    setMaintenanceRequests(await refreshResponse.json())
  } catch (error) {
    setModuleError(
      error instanceof Error ? error.message : 'Unable to update status.'
    )
  }
}


async function searchStudentAllocation(
  event: React.FormEvent<HTMLFormElement>
) {
  event.preventDefault()

  if (!studentSearch.trim()) {
    setAllocationError('Enter a student ID, roll number, or name.')
    return
  }

  try {
    setAllocationLoading(true)
    setAllocationError('')
    setSearched(true)
    setAllocationResults([])

    const response = await fetch(
      `${API_URL}/api/allocations/student?search=${encodeURIComponent(studentSearch.trim())}`
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Could not find student.')
    }

    setAllocationResults(Array.isArray(data) ? data : [data])
  } catch (error) {
    setAllocationError(
      error instanceof Error
        ? error.message
        : 'Something went wrong.'
    )
  } finally {
    setAllocationLoading(false)
  }
}
useEffect(() => {
  async function loadData() {
    try {
      setLoading(true)
      setApiError('')

      const [hostelResponse, roomResponse, allocationResponse] =
        await Promise.all([
          fetch(`${API_URL}/api/hostels`),
          fetch(`${API_URL}/api/rooms`),
          fetch(`${API_URL}/api/allocations`),
        ])

      if (
        !hostelResponse.ok ||
        !roomResponse.ok ||
        !allocationResponse.ok
      ) {
        throw new Error('Failed to load database data.')
      }

      const [hostelData, roomData, allocationData] =
        await Promise.all([
          hostelResponse.json(),
          roomResponse.json(),
          allocationResponse.json(),
        ])

      setHostels(hostelData)
      setRooms(roomData)
      setAllocations(allocationData)
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : 'Something went wrong.'
      )
    } finally {
      setLoading(false)
    }
  }

  loadData()
}, [])

useEffect(() => {
  if (activePage !== 'Visitors' && activePage !== 'Maintenance') return

  async function loadModuleData() {
    setModuleLoading(true)
    setModuleError('')

    try {
      const endpoint = activePage === 'Visitors' ? 'visitors' : 'maintenance'
      const response = await fetch(`${API_URL}/api/${endpoint}/`)

      if (!response.ok) {
        throw new Error(`Failed to load ${activePage.toLowerCase()}.`)
      }

      const data = await response.json()

      if (activePage === 'Visitors') {
        setVisitors(data)
      } else {
        setMaintenanceRequests(data)
      }
    } catch (error) {
      setModuleError(
        error instanceof Error ? error.message : 'Unable to load records.'
      )
    } finally {
      setModuleLoading(false)
    }
  }

  loadModuleData()
}, [activePage])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">H</div>
          <div>
            <h2>HostelHub</h2>
            <p>Management System</p>
          </div>
        </div>

        <p className="menu-label">MAIN MENU</p>

        <nav>
          {menuItems.map((item) => (
            <button
              key={item}
              className={`nav-item ${activePage === item ? 'selected' : ''}`}
              onClick={() => setActivePage(item)}
            >
              <span>{{
                Dashboard: '▦',
                Hostels: '⌂',
                Rooms: '▤',
                'Room Allocations': '⇄',
                Students: '♙',
                Maintenance: '⚒',
                Visitors: '♧',
                Reports: '▥',
              }[item]}</span>
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="avatar">A</div>
          <div>
            <strong>Administrator</strong>
            <p>System Manager</p>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="breadcrumb">Pages / {activePage}</p>
            <h1>{activePage}</h1>
          </div>
          <div className="topbar-right">
            <span className="status-dot" />
            <span>Hostel Administration</span>
            <div className="profile">A</div>
          </div>
        </header>
        {loading && <p>Loading hostel data...</p>}
        {apiError && <p role="alert">{apiError}</p>}


        {activePage === 'Dashboard' ? (
          <>
            <section className="welcome">
              <div>
                <p className="eyebrow">HOSTEL OVERVIEW</p>
                <h2>Welcome back, Administrator!</h2>
                <p>Manage hostels, rooms and student allocations in one place.</p>
              </div>
              <div className="welcome-icon">⌂</div>
            </section>

            <section className="stats-grid">
              <article className="stat-card">
                <div className="stat-icon purple">⌂</div>
                <p>Total Hostels</p>
                <h3>2</h3>
                <span>Registered hostels</span>
              </article>
              <article className="stat-card">
                <div className="stat-icon blue">▤</div>
                <p>Total Rooms</p>
                <h3>{rooms.length}</h3>
                <span>Across all hostels</span>
              </article>
              <article className="stat-card">
                <div className="stat-icon green">♙</div>
                <p>Allocations</p>
                <h3>{allocations.length}</h3>
                <span>Records in database</span>
              </article>
              <article className="stat-card">
                <div className="stat-icon orange">✓</div>
                <p>System Status</p>
                <h3 className="status-text">Setup</h3>
                <span>Database connection pending</span>
              </article>
            </section>

            <section className="content-grid">
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Hostel Management</h2>
                    <p>Manage your hostel details</p>
                  </div>
                  <button className="primary-button" onClick={() => setShowForm(!showForm)}>
                    {showForm ? 'Cancel' : '+ Add Hostel'}
                  </button>
                </div>

                {showForm && (
                  <form className="hostel-form" onSubmit={addHostel}>
                    <label>
                      Hostel name
                      <input required value={hostelName} onChange={(e) => setHostelName(e.target.value)} placeholder="Enter hostel name" />
                    </label>
                    <label>
                      Address
                      <input required value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter address" />
                    </label>
                    <label>
                      Warden name
                      <input required value={warden} onChange={(e) => setWarden(e.target.value)} placeholder="Enter warden name" />
                    </label>
                    <label>
                      Contact number
                      <input required value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Enter contact number" />
                    </label>
                    <button className="primary-button" type="submit">Save Hostel</button>
                    <p className="form-note">Demo only: this entry is not saved to PostgreSQL yet.</p>
                  </form>
                )}

                {hostels.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>HOSTEL</th><th>WARDEN</th><th>CONTACT</th></tr>
                      </thead>
                      <tbody>
                        {hostels.map((hostel) => (
                          <tr key={hostel.hostel_id}>
                            <td><strong>{hostel.hostel_name}</strong><small>{hostel.address}</small></td>
                            <td>{hostel.warden_name}</td>
                            <td>{hostel.contact_number}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-icon">▤</div>
                    <h3>Ready to manage your hostels</h3>
                    <p>Your existing hostel records will appear here once the backend is connected.</p>
                  </div>
                )}
              </article>

              <article className="panel quick-panel">
                <h2>Quick Actions</h2>
                <p>Common management tasks</p>
                {[
                  ['⌂', 'Manage Hostels', 'View hostel information', 'Hostels'],
                  ['▤', 'Manage Rooms', 'View room details', 'Rooms'],
                  ['⇄', 'Room Allocations', 'Manage room assignments', 'Room Allocations'],
                  ['▥', 'View Reports', 'Explore management reports', 'Reports'],
                ].map(([icon, title, description, page]) => (
                  <button className="quick-action" key={title} onClick={() => setActivePage(page)}>
                    <span className="quick-icon">{icon}</span>
                    <span className="quick-text"><strong>{title}</strong><small>{description}</small></span>
                    <span className="arrow">›</span>
                  </button>
                ))}
              </article>
            </section>
          </>

        ) : activePage === 'Rooms' ? (
          <section className="panel">
            <h2>Manage Rooms</h2>
            <p>Room details loaded from the database</p>

            {rooms.length === 0 ? (
              <p>No rooms found.</p>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Room No.</th>
                      <th>Type</th>
                      <th>Capacity</th>
                      <th>Monthly Fee</th>
                      <th>Block ID</th>
                      <th>Floor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((room) => (
                      <tr key={room.room_id}>
                        <td>{room.room_number}</td>
                        <td>{room.room_type}</td>
                        <td>{room.capacity}</td>
                        <td>{room.monthly_fee}</td>
                        <td>{room.hostel_id}</td>

                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              className="primary-button"
              onClick={() => setActivePage('Dashboard')}
            >
              Back to Dashboard
            </button>
          </section>

        ) : activePage === 'Room Allocations' ? (
          <section className="panel">
            <h2>Room Allocation Lookup</h2>
            <p>Search by student ID, roll number, or name.</p>

            <form onSubmit={searchStudentAllocation}>
              <input
                type="text"
                value={studentSearch}
                onChange={(event) =>
                  setStudentSearch(event.target.value)
                }
                placeholder="Enter student ID, roll number, or name"
                required
              />

              <button
                className="primary-button"
                type="submit"
                disabled={allocationLoading}
              >
                {allocationLoading ? 'Searching...' : 'Search Allocation'}
              </button>
            </form>

            {allocationError && (
              <p role="alert">{allocationError}</p>
            )}

            {allocationResults.map((student, index) => (
              <article
                className="panel"
                key={`${student.student_id}-${index}`}
              >
                <h3>Student Details</h3>
                <p><strong>Student ID:</strong> {student.student_id}</p>
                <p><strong>Roll Number:</strong> {student.roll_number}</p>
                <p><strong>Name:</strong> {student.full_name}</p>
                <p><strong>Email:</strong> {student.email || 'Not available'}</p>
                <p><strong>Phone:</strong> {student.phone || 'Not available'}</p>

                {student.allocation_id != null ? (
                  <>
                    <h3>Room is allocated!</h3>
                    <p><strong>Hostel:</strong> {student.hostel_name || 'Not available'}</p>
                    <p><strong>Room Number:</strong> {student.room_number || 'Not available'}</p>
                    <p><strong>Room Type:</strong> {student.room_type || 'Not available'}</p>
                    <p><strong>Capacity:</strong> {student.capacity ?? 'Not available'}</p>
                    <p><strong>Monthly Fee:</strong> {student.monthly_fee ?? 'Not available'}</p>
                    <p><strong>Status:</strong> {student.status}</p>
                    <p>
                      <strong>Allocation Date:</strong>{' '}
                      {student.allocation_date
                        ? student.allocation_date.slice(0, 10)
                        : 'Not available'}
                    </p>
                  </>
                ) : (
                  <p>This student has no active room allocation.</p>
                )}
              </article>
            ))}

            <button
              className="primary-button"
              onClick={() => setActivePage('Dashboard')}
            >
              Back to Dashboard
            </button>
          </section>

) : activePage === 'Visitors' ? (
  <section className="panel">
    <h2>Visitor Management</h2>
    <p>Visitor records from the database</p>

{moduleError && <p role="alert">{moduleError}</p>}

{moduleLoading ? (
  <p>Loading visitors...</p>
) : visitors.length === 0 ? (
  <p>No visitor records found.</p>
) : (

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Visitor</th>
              <th>Student</th>
              <th>Phone</th>
              <th>Visit Date</th>
              <th>Purpose</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Action</th>

            </tr>
          </thead>
          <tbody>
            {visitors.map((visitor) => (
              <tr key={visitor.visitor_id}>
                <td>{visitor.visitor_name}</td>
                <td>{visitor.student_name}</td>
                <td>{visitor.visitor_phone || '—'}</td>
                <td>{visitor.visit_date?.slice(0, 10) || '—'}</td>
                <td>{visitor.purpose}</td>

<td>
  {visitor.check_in_time || 'Not checked in'}
</td>
<td>
  {visitor.check_out_time || 'Not checked out'}
</td>
<td>
  {!visitor.check_in_time ? (
    <button
      className="primary-button"
      onClick={() => updateVisitorAttendance(visitor.visitor_id, 'check-in')}
    >
      Check In
    </button>
  ) : !visitor.check_out_time ? (
    <button
      className="primary-button"
      onClick={() => updateVisitorAttendance(visitor.visitor_id, 'check-out')}
    >
      Check Out
    </button>
  ) : (
    <span>Completed</span>
  )}
</td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    <button
      className="primary-button"
      onClick={() => setActivePage('Dashboard')}
    >
      Back to Dashboard
    </button>
  </section>
) : activePage === 'Maintenance' ? (
  <section className="panel">
    <h2>Maintenance Requests</h2>
    <p>Maintenance records from the database</p>

    {moduleLoading ? (
      <p>Loading maintenance requests...</p>
    ) : moduleError ? (
      <p role="alert">{moduleError}</p>
    ) : maintenanceRequests.length === 0 ? (
      <p>No maintenance requests found.</p>
    ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Student</th>
              <th>Room</th>
              <th>Issue</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Reported</th>
            </tr>
          </thead>
          <tbody>
            {maintenanceRequests.map((request) => (
              <tr key={request.request_id}>
                <td>{request.request_id}</td>
                <td>{request.student_name}</td>
                <td>{request.room_id}</td>
                <td>
                  <strong>{request.issue_title}</strong>
                  <small>{request.issue_description}</small>
                </td>
                <td>{request.priority}</td>

                <td>
                  <select
                  value={request.request_status}
                  onChange={(event) =>
                    updateMaintenanceStatus(request.request_id, event.target.value)
                  }
                  >
                    <option value="Open">Open</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </td>

                <td>{request.reported_at?.slice(0, 10) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    <button
      className="primary-button"
      onClick={() => setActivePage('Dashboard')}
    >
      Back to Dashboard
    </button>
  </section>

) : activePage === 'Students' ? (
  <section className="panel">
    <h2>Student Directory</h2>
    <p>Search student records and view their room assignments.</p>

    <form onSubmit={searchStudentAllocation}>
      <input
        type="text"
        value={studentSearch}
        onChange={(event) => setStudentSearch(event.target.value)}
        placeholder="Enter student ID, roll number, or name"
        required
      />
      <button
        className="primary-button"
        type="submit"
        disabled={allocationLoading}
      >
        {allocationLoading ? 'Searching...' : 'Search Student'}
      </button>
    </form>

    {allocationError && <p role="alert">{allocationError}</p>}

    {allocationLoading && <p>Searching student records...</p>}

    {!allocationLoading && searched && allocationResults.length === 0 &&
      !allocationError && <p>No student records found.</p>}

    {allocationResults.map((student) => (
      <article className="panel" key={student.student_id}>
        <h3>{student.full_name}</h3>
        <p><strong>Student ID:</strong> {student.student_id}</p>
        <p><strong>Roll Number:</strong> {student.roll_number}</p>
        <p><strong>Email:</strong> {student.email || 'Not available'}</p>
        <p><strong>Phone:</strong> {student.phone || 'Not available'}</p>

        <h4>Room Assignment</h4>
        {student.allocation_id != null ? (
          <>
            <p><strong>Hostel:</strong> {student.hostel_name || 'Not available'}</p>
            <p><strong>Room:</strong> {student.room_number || 'Not available'}</p>
            <p><strong>Room Type:</strong> {student.room_type || 'Not available'}</p>
            <p><strong>Allocation Status:</strong> {student.status || 'Not available'}</p>
          </>
        ) : (
          <p>No active room allocation found.</p>
        )}
      </article>
    ))}

    <button
      className="primary-button"
      onClick={() => setActivePage('Dashboard')}
    >
      Back to Dashboard
    </button>
  </section>
) : activePage === 'Reports' ? (
  <section className="panel">
  <h2>Reports</h2>
  <p>Hostel Management System summary</p>

  <div className="stats-grid">
    <article className="stat-card">
      <h3>Total Hostels</h3>
      <p>{hostels.length}</p>
    </article>

    <article className="stat-card">
      <h3>Total Rooms</h3>
      <p>{rooms.length}</p>
    </article>

    <article className="stat-card">
      <h3>Total Allocations</h3>
      <p>{allocations.length}</p>
    </article>

    <article className="stat-card">
      <h3>Visitor Records</h3>
      <p>{visitors.length}</p>
    </article>

    <article className="stat-card">
      <h3>Maintenance Requests</h3>
      <p>{maintenanceRequests.length}</p>
    </article>
  </div>

  <h3>Room Inventory</h3>
  {rooms.length === 0 ? (
    <p>No room records available.</p>
  ) : (
    <table>
      <thead>
        <tr>
          <th>Room Number</th>
          <th>Room Type</th>
          <th>Capacity</th>
          <th>Monthly Fee</th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((room) => (
          <tr key={room.room_number}>
            <td>{room.room_number}</td>
            <td>{room.room_type}</td>
            <td>{room.capacity}</td>
            <td>{room.monthly_fee}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )}

  <button
    className="primary-button"
    onClick={() => window.print()}
  >
    Print Report
  </button>

  <button
    className="primary-button"
    onClick={() => setActivePage('Dashboard')}
  >
    Back to Dashboard
  </button>
</section>
) : (
  <section className="panel page-placeholder">
    <div className="empty-icon">▤</div>
    <h2>{activePage}</h2>
    <p>This section is ready for the next development step.</p>
    <button
      className="primary-button"
      onClick={() => setActivePage('Dashboard')}
    >
      Back to Dashboard
    </button>
  </section>
)}




        <footer>HostelHub Management System <span>•</span> Project Dashboard</footer>
      </main>
    </div>
  )
}

export default App